# Greenhouse connector (issue #5)

Ingests job postings from the [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html)
(public, unauthenticated, no API key) into the `job_listings` table, keyed
for idempotent re-runs on `(source_connector, external_id)` --
`source_connector = "Greenhouse"`, `external_id` = Greenhouse's numeric job
`id`.

## Running it

```
cd packages/db
cp connectors/greenhouse/boards.example.json connectors/greenhouse/boards.json
# edit boards.json to list the boards you want to track
npm run db:seed:greenhouse
```

Or from the repo root: `npm run db:seed:greenhouse` (delegates to this
workspace).

Requires `DATABASE_URL` (and a generated Prisma client -- `npm run
db:generate`) the same as any other packages/db script. No other setup: the
Greenhouse endpoint needs no auth.

## How this runs -- an explicit decision, not a default

There's no job-scheduler/cron infrastructure anywhere in this repo yet. Two
ways this could have gone:

- **Build scheduling infrastructure now** (a queue, a cron runner, a
  long-lived worker process) so ingestion "just happens" on a schedule.
- **A standalone script, run manually today, schedulable later** once the
  project actually has a scheduling story (which is a decision bigger than
  this one connector, and not this issue's scope).

This connector does the latter: `run.ts` is a one-shot script (`npm run
db:seed:greenhouse`) you invoke by hand, or point at cron/a serverless
scheduled function/CI later with zero code changes -- it's idempotent
(upserts on `source_connector, external_id`), so running it repeatedly on a
timer is already safe. Building a scheduler for one connector would be
over-building ahead of the actual need.

## Configuring which boards to track

Which companies' Greenhouse boards to pull is deployment-specific
configuration, not something to hardcode. Two options, checked in this
order:

1. **`GREENHOUSE_BOARD_TOKENS`** env var -- comma-separated board tokens
   (e.g. `GREENHOUSE_BOARD_TOKENS=gitlab,asana`) for a quick run with no
   per-board metadata.
2. **`connectors/greenhouse/boards.json`** (git-ignored, like `.env`) -- a
   JSON array of `{ boardToken, companyName?, companySize?, industry? }`
   objects; see `boards.example.json` (checked in) for the format and
   `config.ts` for field-by-field docs. `companySize`/`industry` are
   optional static facts about the company you supply yourself -- Greenhouse's
   API has no employee-count or industry field, so these can't be inferred
   per job the way location/title-derived fields can.

Override the JSON file's path with `GREENHOUSE_BOARDS_CONFIG=/abs/path.json`.

## What gets normalized, and what's deliberately left null

The task here was: map Greenhouse's data into `JobListing` using its
free-text classifier columns, matching the app's existing label conventions
(`apps/web/lib/repository/seed-jobs.ts`, e.g. `"Hybrid"`, `"Full-time"`,
`"Staff / Principal"`) where confidently inferable, and leave a field null
rather than guess when it isn't. What the real, public Greenhouse Job Board
API actually exposes (confirmed by hitting several real boards -- gitlab,
asana, squarespace, elastic -- during development) drove which fields fall
into which bucket:

| Field | Source | Confidence |
|---|---|---|
| `title`, `company`, `url`, `external_id` | Direct fields (`title`, `company_name`/config override, `absolute_url`, `id`) | Always set |
| `location` | `location.name` verbatim (e.g. `"Austin, TX"`, `"Remote, Italy"`) | Always set (or null if Greenhouse omits it) |
| `date_posted` | `first_published`, falling back to `updated_at` | Always set unless both are missing |
| `remote_type` | `"Remote"` only if every segment of `location.name` says so; `"Hybrid"` if any segment says so | Left null for a bare office location -- Greenhouse doesn't distinguish hybrid from onsite, so guessing "Onsite" for anything not explicitly remote would be exactly the kind of guess the task says to avoid |
| `employment_type` | Title keyword match: `intern(ship)` -> Internship, `contract(or)` -> Contract, `part-time` -> Part-time | Left null otherwise -- most Greenhouse postings are presumably full-time, but assuming that for everything without an explicit marker would be an assumption, not an inference |
| `level` | Title keyword match, most-senior-first: exec/VP titles, `director`, `staff`/`principal`, `senior`/`sr`, then entry-level signals (`intern`, `junior`, `associate`, `entry level`, `new grad`) | Left null for a bare title like `"Product Manager"` -- no keyword signal either way between Mid level and Entry level, and bare `"manager"` is itself ambiguous between an IC title (Product/Program Manager) and a people-manager level (Engineering Manager), so `"Manager"` level is never inferred from title alone |
| `salary_min` / `salary_max` | -- | Always null. Greenhouse's public API has no structured compensation field on any board inspected. Some postings show a pay range as prose inside the job's HTML `content`, but reliably parsing that out of free text is out of scope here (see follow-ups) |
| `company_size` / `industry` | `boards.json`'s optional per-board `companySize`/`industry` | Static, operator-supplied fact about the company, not a per-job inference -- there's no API signal to derive either from |
| `raw_payload` | The full, untouched Greenhouse job object (including `content`, the HTML description) | Always stored, precisely so a future normalization pass (e.g. salary extraction from `content`) doesn't need to re-fetch anything |

## Open follow-ups (not built here -- flagged, not guessed)

- **Scheduling.** See above -- this is a manual/cron-ready script, not a
  scheduler.
- **Pagination / large boards.** The Greenhouse list endpoint returns every
  job for a board in one response (verified up to ~170 jobs on a real
  board); very large boards may need pagination if Greenhouse's API caps
  response size, which wasn't hit during development.
- **Rate limiting / backoff.** Each run fetches every configured board once
  with no concurrency limiting, retry, or backoff. Fine for a handful of
  boards run occasionally; add if the tracked-board list grows large or runs
  get frequent enough to hit Greenhouse's rate limits.
- **Salary extraction from `content`.** Some Greenhouse postings include a
  pay range in prose inside the HTML description. `raw_payload` retains that
  content specifically so a later normalization pass could parse it out
  without re-fetching, but this connector doesn't attempt it -- reliable
  extraction from unstructured HTML is a meaningfully different (and riskier
  to get subtly wrong) problem than the structured-field mapping this pass
  does.
- **Other ATS connectors.** Lever/Ashby/Workday (referenced in
  `seed-jobs.ts`'s fixture data) aren't built -- this issue was scoped to
  Greenhouse only. Each would live alongside this one under `connectors/`
  with its own fetch/normalize/config, sharing the same
  `(source_connector, external_id)` upsert pattern.
- **Live-DB verification.** Like the rest of packages/db (see the root
  README's "Open questions" section), no reachable Postgres/Docker was
  available while building this in this environment. Validated via
  `prisma validate`/`tsc --noEmit`/`eslint` and real HTTPS calls against
  live Greenhouse boards (not mocked), but the actual `prisma.jobListing.upsert`
  path has not been exercised against a live database -- do that before
  relying on this in production.
