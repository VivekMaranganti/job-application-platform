# Auth strategy (issue #3)

This mirrors `packages/db/README.md`'s "Stack decision: Prisma" section —
issue #3 explicitly flagged auth as an open architectural decision rather
than something to guess at silently, so here's the decision and reasoning.

## Decision: hand-rolled email magic-link + session cookie

No auth dependency was installed anywhere in this repo, and no OAuth
app/client id is configured for any provider. Given that, and given this is
an early-stage, single-user-per-account app with no hosting/deployment
target chosen yet, the options considered were:

1. **Auth.js / NextAuth v5 with an OAuth provider** (Google, GitHub, etc.)
   — ruled out. There's no OAuth app registered anywhere, and registering
   one needs a real, publicly reachable callback URL, which this sandbox
   doesn't have. Nothing about that flow is testable end-to-end here, and
   picking a specific provider (Google vs. GitHub vs. ...) is itself a
   product decision this issue doesn't need to force.
2. **Auth.js / NextAuth v5 with its built-in Email provider** — ruled out.
   That provider needs a real SMTP/email-API integration (none configured)
   *and* its own `verification_token`/adapter-managed session tables, which
   would mean adopting NextAuth's schema/adapter conventions on top of the
   schema issue #2 already built. It's a reasonable production choice later,
   but it's a heavier dependency than this step needs today.
3. **Username/password (Credentials provider or hand-rolled)** — ruled out.
   The `User` model (packages/db/prisma/schema.prisma) intentionally has no
   password field, and adding one means owning password hashing, reset
   flows, and rate-limiting — real scope for very little benefit in an
   early-stage app that's going to want passwordless auth eventually anyway.
4. **Hand-rolled email magic-link + session cookie (chosen).** No new
   dependency, no external service to configure, and provable end-to-end in
   this sandbox without a live SMTP server or OAuth callback (see "Dev-mode
   shortcut" below). It's a small amount of code (`apps/web/lib/auth.ts`,
   ~120 lines) and follows the same pattern the project already uses
   elsewhere: `packages/db/lib/encryption.ts` hand-rolls AES-256-GCM instead
   of pulling in a crypto library, for the same reason (matches the actual
   scope needed, no dependency with its own opinions to fight).

If/when a specific hosting provider and a real transactional-email service
are chosen, swapping in Auth.js (or wiring real SMTP into this same flow) is
a contained change: it replaces `apps/web/lib/auth.ts` and the three routes
under `app/api/auth/`, not the `Repository`/`getCurrentUserId()` seam that
the rest of the app calls through (see "What this plugs into" below).

## How it works

1. `POST /api/auth/request-login { email }` — creates the `users` row if
   this is a new email (this **is** signup; there's no separate "create
   account" step, which is normal for magic-link auth and proportionate
   here), then issues a single-use login token good for 15 minutes.
2. The token's **raw value is never persisted** — only its SHA-256 hash
   (`login_tokens.token_hash`). This is the same "never store sensitive
   plaintext" rule the project already applies to resume URLs and
   `RequiredInfoAnswer` values (see `packages/db/README.md` "Encryption at
   rest"), applied to auth tokens: a leaked row is useless without the
   original emailed link.
3. `GET /api/auth/verify?token=...` — the link the user clicks. Consumes the
   token (single-use, must be unexpired), mints a session (again: raw value
   never stored, only `sessions.token_hash`), sets it as an `httpOnly`,
   `sameSite=lax` cookie (`secure` in production), and redirects to `/`.
4. `POST /api/auth/logout` — deletes the session row and clears the cookie.
5. `lib/current-user.ts`'s `getCurrentUserId()` / `getCurrentUser()` read
   the cookie via `next/headers`'s `cookies()`, hash it, and look up the
   session. Both are `async` and both can return `null` (there's now a real
   signed-out state, which didn't exist under the mock) — API routes turn
   that into a 401 via `lib/require-user.ts`'s `requireUserId()`; `app/page.tsx`
   (a Server Component) redirects to `/login`.

### Why a plain SHA-256 hash and not bcrypt/argon2

Password hashes need to be slow (bcrypt/argon2) because passwords are
low-entropy and user-chosen, so a fast hash would make offline brute-forcing
cheap. Login tokens and session ids here are the opposite: 32
cryptographically random bytes, never chosen or reused by a person. A fast
hash is the correct tool for high-entropy tokens — the same reasoning GitHub
uses for personal access tokens and most session-cookie implementations use
for session ids.

### Dev-mode shortcut: no real email is sent

There's no SMTP/SES/Postmark/etc. credential anywhere in this repo, and
nothing in this sandbox can receive a real email. So "sending the email" is
stubbed: `request-login`'s route handler `console.log`s the magic link, and
**outside of `NODE_ENV=production`** also returns it directly in the JSON
response (`devLoginUrl`), which `/login`'s page renders as a clickable link.
This is how the flow can be exercised end-to-end (`curl`, or the browser)
without a real inbox.

That response field is hard-disabled once `NODE_ENV=production` — not just
hidden by a flag a caller could override — because handing back the login
token in the API response would let anyone sign in as anyone just by
knowing their email address. Wiring a real transactional-email provider
(and deleting that response field entirely) is the follow-up before any
real deployment; it's the same shape of "pluggable, not yet chosen" decision
as `KeyProvider`/`ResumeStorage` in `packages/db`.

## What this plugs into

Every `Repository` method (`apps/web/lib/repository/types.ts`) already took
an explicit `userId: string` parameter before this issue — that multi-tenancy
plumbing existed specifically so auth could be slotted in later without
touching the repository interface or any of its callers. This issue:

- Replaced the `MOCK_USER_ID` constant / synchronous `getCurrentUserId()` in
  `lib/current-user.ts` with real, request-scoped, `async` resolution.
- Removed `ensureUser()` from `lib/repository/postgres.ts` — that lazy
  upsert existed only because there was no real signup flow to create
  `users` rows. `lib/auth.ts`'s `requestLogin()` now does that for real, so
  every `userId` reaching the repository is guaranteed to already have a row.
- Added two tables (`login_tokens`, `sessions`) via
  `packages/db/prisma/migrations/20260716120000_add_auth_login_tokens_sessions/`.
  Both follow the FK-to-`users`-with-cascade-delete pattern already
  established by every other user-scoped table in that schema.

Nothing outside `lib/current-user.ts`, `lib/require-user.ts`, `lib/auth.ts`,
and the three `app/api/auth/*` routes needed to know any of this — API
routes changed only their one-line "resolve the current user" call.

## Open follow-ups (flagged, not solved here)

- **Real email delivery.** See "Dev-mode shortcut" above — a transactional
  email provider needs to be chosen before this can go to production.
- **Rate limiting `/api/auth/request-login`.** Nothing currently stops
  someone from spamming login-token creation for an arbitrary email. Fine
  for an early-stage/dev-only app; needs addressing (e.g. per-email/IP rate
  limit) before production.
- **Session revocation UX.** There's no "sign out everywhere" / active
  session list. Single `sessions` row per login is enough for now; a
  multi-device UI is a later, separate feature.
- **Expired-session UX mid-session.** If a session expires while the SPA
  (`AppShell`) is open, in-flight API calls will start 401ing rather than
  redirecting the user back to `/login` automatically. Acceptable for this
  stage; a client-side 401 interceptor that redirects would close the gap.
