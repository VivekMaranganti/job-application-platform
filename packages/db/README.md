# auto-job-applier-db (placeholder)

This directory is a placeholder. The real package — Prisma schema, migrations,
generated client, and the shared application-layer encryption helper — is
owned by issue #2 and being built on branch `agent/postgres-schema` (see
`auto-job-applier-db` there: `prisma/schema.prisma`, `prisma/migrations/`,
and an in-progress `lib/` for the encryption helper).

It exists so that `apps/web`'s workspace dependency on `auto-job-applier-db`
resolves under npm workspaces *before* the two branches are merged. Nothing
in `apps/web` currently imports real functionality from this package —
`apps/web/lib/repository` is written against an in-memory stub today, shaped
so it can be rewired to import this package's Prisma client and encryption
helper once merged, without changing call sites elsewhere in the app.

At merge time, whoever reconciles `agent/scaffold-nextjs` and
`agent/postgres-schema`:
1. Replaces the contents of this directory with the real `auto-job-applier-db`
   package (schema, migrations, generated client, `lib/encryption.ts`).
2. Rewires `apps/web/lib/repository/postgres.ts` (currently absent — see the
   TODO in `apps/web/lib/repository/index.ts`) to use the real Prisma client
   and encryption helper instead of the in-memory store.

Known naming difference to reconcile at that point: this scaffold's domain
types (`apps/web/lib/types.ts`) use snake_case field names matching the
data-model spec verbatim (`user_id`, `resume_file_url`, etc.) as the app's
internal/API-contract shape, while the real package's Prisma client will
expose camelCase JS fields per Prisma convention (`userId`,
`resumeFileUrlEncrypted`, etc.) and ciphertext for sensitive columns. The
Postgres-backed repository implementation is expected to do that
snake_case-plaintext <-> camelCase-ciphertext mapping (encrypt on write,
decrypt on read) — callers above the repository layer never see ciphertext
or Prisma's field names.
