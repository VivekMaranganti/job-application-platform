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

export const MOCK_USER_ID = "user_dev_1";

/** Placeholder for a future request-scoped lookup. Currently always returns the mock user. */
export function getCurrentUserId(): string {
  return MOCK_USER_ID;
}
