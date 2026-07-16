# auto-job-applier — database package

Postgres schema and migrations for the auto-job-applier data model
(GitHub issue #2). This package is intentionally standalone: it is the
persistence layer that the Next.js app scaffold (issue #1, branch
`agent/scaffold-nextjs`) and any future service (e.g. a
browser-orchestration "apply agent") will depend on and import from. It
should stay its own package rather than being absorbed into the app tree.

## Stack decision: Prisma

No ORM/migration tool was already decided in the repo (no existing
`package.json` on the integration branch this was built from). **Prisma**
was chosen because:

- Postgres + TypeScript + Next.js is Prisma's core supported combination.
- Native support for arrays (`String[]`, enum arrays) and `Json`/`jsonb`,
  both of which this schema needs (`Filters.industries`,
  `JobListing.rawPayload`, etc.).
- `prisma migrate` gives versioned, reviewable SQL migrations (checked into
  `prisma/migrations/`) rather than a black-box migration DSL.

This is a stack choice, not just a schema detail — flag it for review if a
different ORM/migration tool is preferred before this merges.

## Layout

```
prisma/
  schema.prisma            # source of truth for the data model
  migrations/
    migration_lock.toml
    <timestamp>_init/migration.sql
    <timestamp>_add_profile_resume_metadata/migration.sql
lib/
  client.ts                 # shared PrismaClient singleton (dev hot-reload safe)
  encryption.ts             # app-layer AES-256-GCM helper for sensitive columns
  encryption-provider.ts    # adapter matching the Next.js scaffold's EncryptionProvider shape
  resume-storage.ts         # pluggable resume file storage (ResumeStorage), local-disk dev default
index.ts                    # package entry point -- import everything through this
.env.example                # DATABASE_URL / FIELD_ENCRYPTION_KEY placeholders
```

This package lives at `packages/db` in the npm-workspaces monorepo set up on
`agent/scaffold-nextjs` (issue #1) as `packages/db/package.json`'s
`auto-job-applier-db` name/placeholder there expects. It was moved here from
the repo root (where it was originally built standalone) so that workspace
dependency resolution (`apps/web` depending on `auto-job-applier-db`) works
without a manual path hack once the two branches merge.

## Running migrations locally

1. Have a Postgres instance reachable (local install, Docker, or a hosted
   dev DB). Example with Docker:
   ```
   docker run --name auto-job-applier-db -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=auto_job_applier -p 5432:5432 -d postgres:16
   ```
2. `cp .env.example .env` and fill in `DATABASE_URL` (and
   `FIELD_ENCRYPTION_KEY` — see below).
3. `npm install`
4. Apply the existing migration(s):
   ```
   npm run db:migrate:deploy   # applies committed migrations, no new ones created
   ```
   or, while iterating on the schema during development:
   ```
   npm run db:migrate:dev      # diffs schema.prisma against the DB and
                                # creates+applies a new migration if needed
   ```
5. `npm run db:generate` to (re)generate the Prisma Client if you're
   consuming it from application code.

Other useful scripts: `npm run db:validate` (schema lint, no DB needed),
`npm run db:format`, `npm run db:studio` (a local data browser), and
`npm run typecheck` for `lib/encryption.ts`.

The initial migration (`prisma/migrations/<timestamp>_init/migration.sql`)
was generated offline with
`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`,
which doesn't require a live database connection, and then hand-edited to
add a defense-in-depth `CHECK` constraint and a few `COMMENT ON COLUMN`
annotations (see the bottom of that file). No database was needed to
produce it, but running it against a real Postgres instance has not been
exercised end-to-end in this branch — do that before merging into
`vivek/persistence-layer`.

## Data model

One table per entity from issue #2: `users`, `profiles`, `filters`,
`required_info_answers`, `job_listings`, `applications`,
`application_log_entries` (see `prisma/schema.prisma` for the authoritative
field list and comments). A few schema-level decisions worth calling out:

- **Closed, user-facing value sets are native Postgres enums.** `levels`,
  `work_arrangement`, `employment_type`, `company_size`, `date_posted`,
  `mode`, `status`, and log `source` are all modeled as Postgres enums via
  Prisma's `@map`, so the exact display label (e.g. `"Staff / Principal"`,
  `"Enterprise (5,000+)"`) is what's stored in the DB, while the generated
  Prisma Client exposes a friendly identifier (`STAFF_PRINCIPAL`). This
  gives real DB-level validation instead of relying only on app code.
- **`JobListing`'s classifier fields are free text, not enums**
  (`remoteType`, `employmentType`, `level`, `companySize`). This is a
  deliberate fork from the enum approach above: listings are ingested from
  heterogeneous external source connectors whose vocabulary won't reliably
  match our closed sets at ingestion time. Forcing an enum here would make
  ingestion brittle (insert failures whenever a connector's label doesn't
  match exactly). `rawPayload` (jsonb) retains the untouched connector
  response specifically so a normalization pipeline can re-derive/repair
  these fields later without re-fetching. If a normalization layer lands
  before this merges and guarantees clean values, revisit tightening these
  to enums.
- **`Profile` and `Filters` use `user_id` as their primary key**, not a
  surrogate `id` — they're 1:1 with `User`, so every lookup is already
  scoped by tenant and there's no meaningful second key.
- **`RequiredInfoAnswer` has a composite primary key `(user_id, field_id)`**
  — one answer per field per user. `field_id` is a plain string, not an
  enum, so new fields can be introduced without a migration. The standard
  field_ids (work_auth, sponsorship, veteran, disability, race_ethnicity,
  gender, security_clearance, criminal_history) are documented in a schema
  comment only. `criminal_history` is modeled identically to every other
  field — whether `auto` mode should be allowed for it in production is a
  legal-review question tracked separately in issue #7, and is
  intentionally **not** enforced here.
- **Multi-tenant indexing:** every table that carries a `user_id` either
  has it as (part of) its primary key (`profiles`, `filters`,
  `required_info_answers`) or has an explicit `@@index([userId])`
  (`applications`, `application_log_entries`) — that's the primary access
  pattern for a multi-tenant app and needs to be fast without a seq scan.
  `job_listings` has no `user_id` — a listing is a shared, tenant-agnostic
  fact, not owned by any one user.
- **`applications` has a unique `(user_id, job_listing_id)` constraint** —
  a user should have at most one `Application` row per listing.
- **`job_listings` has a unique `(source_connector, external_id)`
  constraint** — the natural idempotency key for connector ingestion
  (upsert on this pair rather than duplicating a listing on re-fetch).

## Encryption at rest

Two categories of data need encryption at rest per the project's security
spec: **resume files** and **`RequiredInfoAnswer` values** (work
authorization, veteran/disability status, race/ethnicity, gender, security
clearance, criminal history, etc.).

- **Resume files themselves never touch Postgres.** They live in
  S3-compatible object storage, encrypted at rest there (that's an
  infrastructure/bucket-policy concern, not this schema). The only
  resume-related column in Postgres is `profiles.resume_file_url` — a
  reference/pointer, not the file — and it is modeled as
  `resumeFileUrlEncrypted Bytes?`, i.e. it stores **ciphertext of the URL**,
  never the plaintext URL.
- **`RequiredInfoAnswer.value`** is modeled as `valueEncrypted Bytes?` —
  ciphertext, only meaningful when `mode = AUTO`.

**Settled direction: application-layer envelope encryption, not
Postgres-native crypto.** Earlier drafts of this schema considered
`pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`) as a DB-side option. That
was explicitly ruled out for this project: the database must never be able
to encrypt, decrypt, or even recognize that these bytes represent resume
URLs or race/veteran/disability answers, and no key material should pass
through SQL (query text, logs, `pg_stat_statements`, etc.). There is **no
`CREATE EXTENSION pgcrypto`, no `pgp_sym_*` call, and no DB-side crypto
function anywhere in this schema/migration** — the sensitive columns are
plain opaque `bytea` and the database has no idea what's in them.

Instead, `lib/encryption.ts` implements the encrypt/decrypt seam:

- **AES-256-GCM**, 12-byte random IV per encryption, 16-byte auth tag
  (tampering/corruption is detected on decrypt rather than silently
  producing garbage). Wire format stored in the column:
  `iv (12B) || authTag (16B) || ciphertext`.
- `encryptField(plaintext, keyProvider?)` / `decryptField(blob,
  keyProvider?)` are the two functions any repository-layer code should
  call before writing / after reading these columns. Both pass `null`
  through unchanged so optional fields don't need a branch at every call
  site.
- **Key management is pluggable** via a `KeyProvider` interface
  (`getDataKey(): Promise<Buffer>`) rather than hardcoded. `EnvKeyProvider`
  (reads a base64 32-byte key from `FIELD_ENCRYPTION_KEY`) is the dev/test
  default and is explicitly documented as **not sufficient for
  production** — no rotation, no audit trail, key lives in process env.
  The production `KeyProvider` (AWS KMS / GCP KMS / Vault / etc., ideally
  with envelope encryption — a KMS-wrapped data key cached in memory
  rather than calling the KMS master key per field) is an open decision
  tied to a hosting choice that hasn't been made yet. Swapping it in later
  requires no changes to schema, migrations, or call sites — just a new
  `KeyProvider` implementation passed in (or set as the default).
- Verified with a manual round-trip + tamper test during development
  (encrypt → decrypt returns original plaintext; flipping a ciphertext bit
  causes `decryptField` to throw rather than return corrupted data). No
  automated test suite exists yet in this package — add one alongside
  whichever app first consumes this module.

**`ApplicationLogEntry` never stores raw sensitive values.** It has a
`valueCategory` column (a coarse label like `"work_authorization"` or
`"veteran_status"`) and **no column of any kind that could hold a raw
value** — that absence is the primary enforcement mechanism, not a
convention someone could accidentally violate by writing to the wrong
column. On top of that, a `CHECK (char_length(value_category) <= 100)`
constraint is added as a soft guardrail: it can't prove a value isn't
sensitive, but raw free-text answers are very unlikely to fit in 100
characters, so it catches obvious misuse early.

## Integrating with the Next.js scaffold (issue #1)

`lib/encryption-provider.ts` exports `AesGcmEncryptionProvider`, a small
adapter over `encryptField`/`decryptField` shaped to match the scaffold's
`EncryptionProvider` interface (`apps/web/lib/repository/encryption.ts`:
`encrypt(plaintext: string): Promise<string>` /
`decrypt(ciphertext: string): Promise<string>`, ciphertext as base64
string). The Postgres-backed `Repository` (below) ended up calling
`encryptField`/`decryptField` directly instead, since Prisma `Bytes` columns
round-trip as `Buffer`/`Uint8Array` already -- going through the
string/base64 adapter would just add an unneeded encode/decode step. The
adapter is still here (and still satisfies `EncryptionProvider`
structurally) for any future consumer that wants ciphertext as a string.

**Done:** the Postgres-backed `Repository` implementation lives at
`apps/web/lib/repository/postgres.ts`, wired up in
`apps/web/lib/repository/index.ts` in place of the original in-memory stub.
The camelCase/ciphertext (Prisma) <-> snake_case/plaintext (scaffold domain
types) mapping this doc previously flagged as a TODO is
`apps/web/lib/repository/mapping.ts` (enum literal mapping) plus a couple of
small `Buffer`/`Uint8Array<ArrayBuffer>` conversion helpers at the top of
`postgres.ts` (Prisma 6's generated `Bytes` type is `Uint8Array<ArrayBuffer>`,
narrower than Node's `Buffer<ArrayBufferLike>`, so the two don't structurally
unify without an explicit conversion). Resume storage is
`packages/db/lib/resume-storage.ts`'s `ResumeStorage` interface -- pluggable
the same way `KeyProvider` is; `LocalDiskResumeStorage` is the dev/test
default, a real S3-backed implementation is still open (see below).

This pass also added three plain (non-sensitive) `Profile` columns the
domain type needed that weren't in the original schema --
`resume_file_name`, `resume_file_size`, `resume_mime_type` -- see
`prisma/migrations/20260716063000_add_profile_resume_metadata/`.

## Open questions / things flagged rather than guessed

- **Production `KeyProvider`.** Which KMS backs `FIELD_ENCRYPTION_KEY` in
  production is unresolved, pending a hosting decision. The interface is
  ready; the implementation is not.
- **Production `ResumeStorage`.** Same shape of open question as
  `KeyProvider` above: which S3-compatible provider/bucket backs resume
  storage in production is unresolved, pending the same hosting decision.
  `LocalDiskResumeStorage` (the dev/test default) is explicitly not
  sufficient for production -- see its doc comment in
  `lib/resume-storage.ts`.
- **`JobListing` classifier fields as free text vs. enum.** Flagged above —
  revisit once a connector-normalization pipeline exists and guarantees
  clean values.
- **Neither this migration nor the follow-up one adding the `Profile`
  resume-metadata columns has been run against a live Postgres instance**
  in this environment (no reachable DB/Docker daemon available while
  building either). Both were generated and schema-validated offline via
  `prisma migrate diff`/`prisma validate`; do a real `prisma migrate deploy`
  against a throwaway DB before merging to catch anything the offline diff
  can't (e.g. actual constraint/extension behavior on your target Postgres
  version).
