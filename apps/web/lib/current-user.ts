// ---------------------------------------------------------------------------
// TODO(issue #3): This app is single-user for now. Auth strategy (sessions,
// OAuth, magic link, etc.) is an open architectural decision tracked in
// issue #3 and deliberately NOT decided here.
//
// Every repository function still takes a `userId` argument so the
// multi-tenancy plumbing is already in place — once issue #3 lands, swap
// this constant for whatever derives the real user id from the request
// (e.g. a session cookie or auth token) and thread it through
// `getCurrentUserId(request)` instead of a hardcoded value.
// ---------------------------------------------------------------------------

// A fixed UUID, not a human-readable slug: `users.id` is `@db.Uuid` in the
// Postgres schema (issue #2), so this constant has to be a valid UUID for
// the Postgres-backed Repository (postgres.ts) to use it directly as a
// primary key / foreign key value.
export const MOCK_USER_ID = "00000000-0000-0000-0000-000000000001";

/** Placeholder for a future request-scoped lookup. Currently always returns the mock user. */
export function getCurrentUserId(): string {
  return MOCK_USER_ID;
}
