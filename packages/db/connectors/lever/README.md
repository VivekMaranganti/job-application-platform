# Lever connector

Ingests job postings from the [Lever Postings API](https://github.com/lever/postings-api)
(public, unauthenticated for reads, no API key) into the `job_listings`
table, keyed for idempotent re-runs on `(source_connector, external_id)` --
`source_connector = "Lever"`, `external_id` = Lever's posting `id` (a UUID).

## Running it

```
cd packages/db
cp connectors/lever/sites.example.json connectors/lever/sites.json
# edit sites.json to list the Lever sites you want to track
npm run db:seed:lever
```

Or from the repo root: `npm run db:seed:lever` (delegates to this
workspace).

Requires `DATABASE_URL` (and a generated Prisma client -- `npm run
db:generate`) the same as any other packages/db script. No other setup: the
Lever *postings* endpoint needs no auth (a Lever API key is only required
for the separate application-submission endpoint, which this connector
never calls).

## How this runs, and how it's configured

Same decisions as `connectors/greenhouse/README.md`, unchanged here: a
one-shot idempotent script (not a scheduler/worker), configured via either
the `LEVER_SITES` env var (comma-separated site names, e.g.
`LEVER_SITES=leverdemo,whoop`) or `connectors/lever/sites.json` (git-ignored,
see `sites.example.json` for the format and `config.ts` for field docs).
Override the JSON file's path with `LEVER_SITES_CONFIG=/abs/path.json`.

## What gets normalized, and what's deliberately left null

Same "infer only when confident, leave null rather than guess" principle as
the Greenhouse connector -- but Lever's API happens to expose more
structured signal than Greenhouse's does for a few fields, which changes
what's inferable vs. left null:

| Field | Source | Confidence |
|---|---|---|
| `title`, `url`, `external_id` | Direct fields (`text`, `hostedUrl`, `id`) | Always set |
| `company` | `sites.json`'s `companyName` override, else the raw site slug | Lever's postings API has no company-display-name field at all (unlike Greenhouse's `company_name`) -- there's no per-posting signal to fall back to before the slug |
| `location` | `categories.location` verbatim | Always set (or null if Lever omits it) |
| `date_posted` | `createdAt` (epoch ms) | Always set unless missing/malformed |
| `remote_type` | Lever's own `workplaceType` field (`"remote"` / `"hybrid"` / `"on-site"` / `"unspecified"`), mapped directly | **Direct signal, not inferred** -- Lever has a real field for this, unlike Greenhouse where it has to be guessed from free-text location. `"unspecified"` maps to null, not `"Onsite"` |
| `employment_type` | `categories.commitment` (a real but free-text field, e.g. `"Full-time"`, `"Intern"`) keyword-matched first; falls back to the shared title-keyword inference (`connectors/shared/title-inference.ts`) if commitment is missing/unrecognized | Commitment-based match is a real signal (an explicit field the employer set), not a guess -- see `normalize.ts`'s `inferEmploymentTypeFromCommitment` for why this is allowed to infer `"Full-time"` positively here, unlike the title-only fallback (which never assumes Full-time) |
| `level` | Shared title-keyword inference (`connectors/shared/title-inference.ts`) | Lever's API has no `level` field in its *response* (only as a query **filter** parameter, confirmed against the official docs and a live response) -- same title-only inference as Greenhouse, and the same reasons a bare title is left null |
| `salary_min` / `salary_max` | Lever's own `salaryRange.min`/`.max`, when present | **Direct signal, not inferred** -- unlike Greenhouse, which has no structured compensation field at all. `salaryRange` is optional per Lever's docs; left null when absent |
| `company_size` / `industry` | `sites.json`'s optional per-site overrides | Same as Greenhouse -- static, operator-supplied fact, no API signal to derive either from |
| `raw_payload` | The full, untouched Lever posting object | Always stored |

## Open follow-ups (not built here -- flagged, not guessed)

- **Scheduling / rate limiting / pagination.** Same follow-ups as
  `connectors/greenhouse/README.md`, unchanged. This connector requests a
  single page of up to 1000 postings per site (`fetch.ts`) rather than
  implementing `skip`/`limit` pagination -- fine for the site sizes checked
  during development; revisit if a tracked site has more open postings than
  that.
- **`country`/`allLocations`.** Lever returns both a single primary
  `categories.location` and a `categories.allLocations` array for
  multi-location postings, plus a separate `country` field. Only the
  primary `location` is used today, matching `JobListing.location`'s
  single-string shape in the schema -- `allLocations`/`country` ride along
  in `raw_payload` for a future pass that might want to represent
  multi-location postings more richly.
- **Live-DB verification.** Like the Greenhouse connector, validated via
  `tsc --noEmit`/`eslint` and real HTTPS calls against Lever's live API
  (including the official `leverdemo` demo board, not mocked), but
  `prisma.jobListing.upsert` has not been exercised against a live database
  in this environment (no reachable Postgres here) -- do that before relying
  on this.
