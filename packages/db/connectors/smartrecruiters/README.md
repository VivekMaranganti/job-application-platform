# SmartRecruiters connector

Ingests job postings from the [SmartRecruiters Posting API](https://developers.smartrecruiters.com/docs/posting-api)
(the *Customer API's* Posting API -- public, unauthenticated, no API key)
into the `job_listings` table, keyed for idempotent re-runs on
`(source_connector, external_id)` -- `source_connector = "SmartRecruiters"`,
`external_id` = the posting's `id`.

**Not** the Marketplace "Job Board API" (`api.smartrecruiters.com/feed/*`)
-- that's a different SmartRecruiters product gated behind a partner
`X-SmartToken`, and this connector never calls it. The endpoints used here
(`/v1/companies/{id}/postings` and `/v1/companies/{id}/postings/{postingId}`)
are confirmed public from SmartRecruiters' own docs, whose example requests
are plain `curl` calls with no auth header at all.

## Running it

```
cd packages/db
cp connectors/smartrecruiters/companies.example.json connectors/smartrecruiters/companies.json
# edit companies.json to list the SmartRecruiters companies you want to track
npm run db:seed:smartrecruiters
```

Or from the repo root: `npm run db:seed:smartrecruiters` (delegates to this
workspace).

Requires `DATABASE_URL` (and a generated Prisma client -- `npm run
db:generate`) the same as any other packages/db script. No other setup: the
Posting API's read endpoints need no auth.

A company's *identifier* is found the way SmartRecruiters' own docs
describe: in the SmartRecruiters app, Settings/Admin -> "Career Pages & Job
Ads" -- it's what follows the `/` in `careers.smartrecruiters.com/<identifier>`.

## How this runs, and how it's configured

Same decisions as the other connectors' READMEs, unchanged here: a one-shot
idempotent script (not a scheduler/worker), configured via either the
`SMARTRECRUITERS_COMPANIES` env var (comma-separated company identifiers,
e.g. `SMARTRECRUITERS_COMPANIES=smartrecruiters,acmeCorp`) or
`connectors/smartrecruiters/companies.json` (git-ignored, see
`companies.example.json` for the format and `config.ts` for field docs).
Override the JSON file's path with `SMARTRECRUITERS_COMPANIES_CONFIG=/abs/path.json`.

**One structural difference from the Greenhouse/Lever/Ashby connectors:**
this one makes a second API call per posting. SmartRecruiters' *list*
endpoint (`/postings`) doesn't return a public-facing job page URL at all --
only `ref`, an API URL for fetching the same posting's JSON detail again,
not something a candidate could open in a browser. The *detail* endpoint
(`/postings/{postingId}`) does have one (`postingUrl`), so this connector
calls it once per posting to get a real URL to store in
`JobListing.url` (a required field the schema doesn't allow to be null) --
see fetch.ts and "Open follow-ups" below for the N-plus-1 cost this incurs.

## What gets normalized, and what's deliberately left null

Same "infer only when confident, leave null rather than guess" principle as
the other connectors -- SmartRecruiters returns some fields Greenhouse has
no equivalent for at all (a real `industry` and `company` name on every
posting), and is missing others entirely that Lever/Ashby do have
(compensation).

| Field | Source | Confidence |
|---|---|---|
| `title`, `external_id` | Direct fields (`name`, `id`) | Always set |
| `url` | The *detail* endpoint's `postingUrl` (a second API call per posting -- see above) | Always set for postings whose detail fetch succeeds; a posting is skipped entirely (counted as a failure) if the detail fetch fails or omits `postingUrl`, since the schema requires a real, non-null URL and there's no per-company URL pattern reliable enough to construct one instead -- SmartRecruiters' Posting API exists specifically so customers can build *fully custom* career sites, so there's no single canonical "SmartRecruiters-hosted" URL format the way Greenhouse/Lever/Ashby each have one |
| `company` | The API's own `company.name` field, falling back to `companies.json`'s `companyName` override, then the raw identifier | **Direct signal, not inferred** -- unlike Lever/Ashby, SmartRecruiters' postings do carry a real company display name |
| `location` | Built from `location.city`/`.region`/`.country` (each optional), joined with `, ` | SmartRecruiters splits location into separate fields rather than one free-text string (unlike Greenhouse/Lever/Ashby) -- only the parts actually present are joined, nothing padded in for a missing part |
| `date_posted` | `releasedDate` (ISO date) | Always set unless missing/malformed |
| `remote_type` | `location.remote` (boolean), mapped to `"Remote"` when true | **Partial direct signal** -- real per-posting field, but only distinguishes remote vs. not; `false`/missing maps to null rather than an assumed `"Onsite"`, since there's no way to tell Hybrid from Onsite from this field alone |
| `employment_type` | `typeOfEmployment.label` (real but free-text, e.g. `"Full-time"`, `"Permanent"`) keyword-matched first; falls back to shared title-keyword inference if missing/unrecognized | Same treatment as Lever's `categories.commitment` -- a real employer-set field, not a fixed enum (SmartRecruiters' docs don't publish one), so it's keyword-matched rather than mapped from `id` |
| `level` | `experienceLevel.label` keyword-matched for *unambiguous* terms only (Entry/Internship, Director, Executive/VP/C-level); everything else -- including ambiguous labels like `"Mid-Senior Level"` or `"Associate"` -- falls through to shared title-keyword inference | Deliberately more conservative than the employment-type match: `experienceLevel` has no published enum either, and several of the labels SmartRecruiters' own docs show span more than one bucket in this schema's finer-grained Level union, so only the clearly single-bucket ones are trusted directly |
| `salary_min` / `salary_max` | N/A | **Always null** -- no compensation field exists anywhere in this API's public list or detail response, unlike Lever/Ashby which both have real structured salary data. Not an inference gap; the data simply isn't there to infer from |
| `industry` | The API's own `industry.label`, falling back to `companies.json`'s optional override | **Direct signal, not inferred** -- unlike Greenhouse/Lever/Ashby, where industry is purely a static operator-supplied fact with no API signal at all |
| `company_size` | `companies.json`'s optional override | Same as every other connector -- no API signal exists for this at all |
| `raw_payload` | Both the list-item and detail-fetch objects, stored together as `{ posting, details }` | Always stored -- each response has real fields the other lacks, so neither is dropped |

## Open follow-ups (not built here -- flagged, not guessed)

- **Live-endpoint verification.** Same caveat as the Ashby connector: this
  connector's request/response shapes were validated only against
  SmartRecruiters' official documentation and example requests/responses --
  outbound network access to `api.smartrecruiters.com` is blocked by this
  development environment's sandbox proxy allowlist (the same limitation
  noted elsewhere in this project for Prisma's `binaries.prisma.sh` calls,
  not a code issue). Run a real fetch against a live SmartRecruiters company
  before relying on this in production.
- **N-plus-1 detail fetches / rate limiting.** One extra HTTP request per
  posting (see above) means a company with, say, 500 open postings makes
  501 requests per run. SmartRecruiters documents rate limiting
  (`https://developers.smartrecruiters.com/docs/rate-limiting`) but this
  connector doesn't implement backoff or throttling for it yet -- fine for
  the company sizes this was designed around, flagged (not silently
  ignored) as a real limit for a company with a very large number of open
  roles. Same "don't build ahead of the actual need" call as the
  pagination follow-ups in the Greenhouse/Lever READMEs.
- **`ref`/API-detail URL reuse.** Since a detail fetch already happens for
  every posting to get `postingUrl`, the connector could skip the separate
  list-then-detail round trip if SmartRecruiters ever added a public URL to
  the list response -- worth revisiting if their API changes, not
  restructured preemptively now.
