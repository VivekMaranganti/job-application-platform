import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getUserForSessionToken, getUserIdForSessionToken } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Issue #3: real request-scoped user resolution, replacing the
// `MOCK_USER_ID` constant this file used to export.
//
// Both functions read the session cookie via `next/headers`'s `cookies()`
// rather than taking a `Request`/`cookies` argument explicitly. That API is
// itself request-scoped (backed by Next.js's per-request AsyncLocalStorage)
// and works identically in Route Handlers and Server Components without
// threading a request object through every call site -- simpler for the ~9
// API routes below than passing `request` into `getCurrentUserId(request)`
// everywhere for no added benefit in the App Router.
//
// Both are `async` and both can return `null` now that there's a real
// signed-out state (there wasn't one under the mock). Every call site must
// handle that -- API routes should respond 401; Server Components should
// redirect to /login (see app/page.tsx).
// ---------------------------------------------------------------------------

/** Resolves the current request's authenticated user id, or `null` if signed out. */
export async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getUserIdForSessionToken(token);
}

/** Resolves the current request's authenticated `{ id, email }`, or `null` if signed out. */
export async function getCurrentUser(): Promise<{ id: string; email: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getUserForSessionToken(token);
}
