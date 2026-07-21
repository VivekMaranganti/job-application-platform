# Ashby connector

Ingests job postings from the [Ashby Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)
(public, unauthenticated, no API key) into the `job_listings` table, keyed
for idempotent re-runs on `(source_connector, external_id)` --
`source_connector = "Ashby"`, `external_id` = the posting's `jobUrl` (see
"What gets normalized" below for why a URL is used instead of an id).

## Running it

```
cd packages/db
cp connectors/ashby/job-boards.example.json connectors/ashby/job-boards.json
# edit job-boards.json to list the Ashby job boards you want to track
npm run db:seed:ashby
```

Or from the repo root: `npm run db:seed:ashby` (delegates to this
workspace).

Requires `DATABASE_URL` (and a generated Prisma client -- `npm run
db:generate`) the same as any other packages/db script. No other setup:
Ashby's Job Postings API needs no auth at all.

## How this runs, and how it's configured

Same decisions as `connectors/greenhouse/README.md` and
`connectors/lever/README.md`, unchanged here: a one-shot idempotent script
(not a scheduler/worker), configured via either the `ASHBY_JOB_BOARDS` env
var (comma-separated job board names, e.g. `ASHBY_JOB_BOARDS=Ashby,Notion`)
or `connectors/ashby/job-boards.json` (git-ignored, see
`job-boards.example.json` for the format and `config.ts` for field docs).
Override the JSON file's path with `ASHBY_JOB_BOARDS_CONFIG=/abs/path.json`.

A job board's *name* (the last path segment of its Ashby-hosted job board
URL, e.g. `Ashby` in `jobs.ashbyhq.com/Ashby`) is found the same way Ashby's
own docs describe: open the company's Ashby-hosted job board and read it
off the URL.

## What gets normalized, and what's deliberately left null

Same "infer only when confident, leave null rather than guess" principle as
the Greenhouse and Lever connectors -- but Ashby happens to expose direct,
structured signal (not free text) for a couple of fields Lever could only
keyword-match, which changes what's a "real signal" vs. an inference here.

| Field | Source | Confidence |
|---|---|---|
| `title`, `url` | Direct fields (`title`, `jobUrl`) | Always set |
| `external_id` | `jobUrl` | **Not a dedicated id field** -- confirmed against Ashby's official field-reference table (not just its example response, which is malformed JSON), the public Job Postings API has no `id`/`jobId` field at all. `jobUrl` is the most stable unique-per-posting value actually returned, so it's used as the idempotency key instead. If Ashby ever adds a real id field, switching to it would change every existing row's `external_id` -- flagged, not silently worked around. |
| `company` | `job-boards.json`'s `companyName` override, else the raw job board name | Same situation as Lever -- Ashby's postings API has no company-display-name field, so there's no per-posting signal to fall back to before the board name |
| `location` | `location` (a plain string) verbatim | Always set (Ashby always returns some location string, even for fully remote postings) |
| `date_posted` | `publishedAt` (ISO datetime) | Always set unless missing/malformed |
| `remote_type` | Ashby's own `workplaceType` field (`"OnSite"` / `"Remote"` / `"Hybrid"`), mapped directly | **Direct signal, not inferred** -- same situation as Lever's `workplaceType`, a real enum field, not a guess from free text |
| `employment_type` | Ashby's own `employmentType` field (`"FullTime"` / `"PartTime"` / `"Intern"` / `"Contract"` / `"Temporary"`), mapped directly | **Direct signal, not inferred, and stronger than Lever's** -- this is a real enum Ashby's UI constrains the employer to, not free text they typed. `"Temporary"` has no equivalent in this schema's employment-type union and is deliberately left to fall through to title-keyword inference rather than being forced into `"Contract"` |
| `level` | Shared title-keyword inference (`connectors/shared/title-inference.ts`) | Ashby's public API has no level/seniority field at all -- same title-only inference as Greenhouse/Lever |
| `salary_min` / `salary_max` | Ashby's `compensation.summaryComponents` (the `"Salary"` component's `minValue`/`maxValue`), when `includeCompensation=true` data is present | **Direct signal, not inferred** -- only present when the employer has configured compensation info; left null for equity-only, unlisted-comp, or `includeCompensation`-absent postings |
| `company_size` / `industry` | `job-boards.json`'s optional per-board overrides | Same as Greenhouse/Lever -- static, operator-supplied fact, no API signal to derive either from |
| `raw_payload` | The full, untouched Ashby job object | Always stored |

Postings with `isListed: false` (Ashby's own "don't show this on the public
board" flag -- reachable only via a direct link) are skipped entirely, not
upserted -- surfacing them anyway would show something the employer chose
not to list publicly.

## Open follow-ups (not built here -- flagged, not guessed)

- **Live-endpoint verification.** Unlike the Greenhouse and Lever
  connectors (both validated against real HTTPS calls during development,
  including Lever's own public `leverdemo` board), this connector's request
  shape was validated only against Ashby's official documentation --
  outbound network access to `api.ashbyhq.com` is blocked by this
  development environment's sandbox proxy allowlist (the same limitation
  noted elsewhere in this project for Prisma's `binaries.prisma.sh` calls,
  not a code issue). Run a real fetch against a live Ashby job board before
  relying on this in production.
- **`external_id`'s stability.** As noted above, `jobUrl` is used as the
  idempotency key because the API has no dedicated id field. If a posting's
  URL ever changes without the posting itself changing (unconfirmed either
  way -- not something that could be checked without a live board to
  observe), a re-run would create a duplicate row rather than updating the
  existing one.
- **Scheduling / rate limiting.** Same follow-up as
  `connectors/greenhouse/README.md` and `connectors/lever/README.md`,
  unchanged.
- **`secondaryLocations`.** Ashby returns a list of additional locations for
  multi-location postings (plus per-location city/region/country detail via
  `address`), matching `JobListing.location`'s single-string shape in the
  schema -- only the primary `location` string is used today;
  `secondaryLocations` rides along in `raw_payload` for a future pass that
  might want to represent multi-location postings more richly.
