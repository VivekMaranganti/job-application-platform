import { randomBytes, createHash } from "node:crypto";
import { prisma } from "auto-job-applier-db";

// ---------------------------------------------------------------------------
// Auth strategy (issue #3): email magic-link + session cookie.
//
// See /apps/web/AUTH.md for the decision and reasoning. Short version: no
// auth dependency is installed and no OAuth client is configured anywhere in
// this repo, and there's no live OAuth callback this sandbox can exercise
// end-to-end -- so this is a small, dependency-free, hand-rolled flow
// (matching how packages/db/lib/encryption.ts already hand-rolls AES-GCM
// rather than pulling in a library) instead of standing up Auth.js/NextAuth
// against a provider nothing here can actually call back to.
//
// Both LoginToken and Session values follow the project's existing "never
// store sensitive plaintext" rule (see packages/db README "Encryption at
// rest"): only a SHA-256 hash of the raw token is ever persisted. A raw
// token is high-entropy (32 random bytes) and single-purpose, so a fast
// cryptographic hash -- not a slow password hash like bcrypt/argon2 -- is
// the right tool here, the same reasoning GitHub/Auth.js use for personal
// access tokens and session ids.
// ---------------------------------------------------------------------------

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Name of the cookie holding the raw (unhashed) session token. */
export const SESSION_COOKIE_NAME = "session_token";
/** Cookie `maxAge` in seconds, mirroring SESSION_TTL_MS. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Starts (or continues) signup/login for `email`.
 *
 * This upserts the `users` row -- there is no separate "create account"
 * step; magic-link auth's first successful login *is* signup, which is the
 * usual shape for this pattern and proportionate for an early-stage,
 * single-user-per-account app. This replaces `ensureUser`'s lazy-upsert
 * hack that used to live in `lib/repository/postgres.ts`: user rows are now
 * created here, for real, at the one place a human actually asserts "this
 * is my email" -- not implicitly on first write from a hardcoded mock id.
 *
 * Returns the *raw* token (never persisted -- only its SHA-256 hash is
 * stored) so the caller can build the magic-link URL / send the email.
 */
export async function requestLogin(email: string): Promise<{ token: string; userId: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {},
    create: { email: normalizedEmail },
  });

  const token = generateToken();
  await prisma.loginToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
    },
  });

  return { token, userId: user.id };
}

/**
 * Consumes a login token (single-use, must be unexpired and not already
 * consumed) and mints a new session for its user.
 *
 * Returns `null` if the token is invalid, expired, or already used -- the
 * caller (the `/api/auth/verify` route) is responsible for turning that
 * into a user-facing error, not this function.
 */
export async function consumeLoginToken(
  token: string
): Promise<{ sessionToken: string; userId: string } | null> {
  const tokenHash = hashToken(token);
  const record = await prisma.loginToken.findUnique({ where: { tokenHash } });
  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    return null;
  }

  await prisma.loginToken.update({
    where: { tokenHash },
    data: { consumedAt: new Date() },
  });

  const sessionToken = generateToken();
  await prisma.session.create({
    data: {
      userId: record.userId,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return { sessionToken, userId: record.userId };
}

/** Resolves a raw session cookie value to its owning user id, or `null`. */
export async function getUserIdForSessionToken(sessionToken: string): Promise<string | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(sessionToken) } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.userId;
}

/** Resolves a raw session cookie value to `{ id, email }`, or `null`. */
export async function getUserForSessionToken(
  sessionToken: string
): Promise<{ id: string; email: string } | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(sessionToken) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return { id: session.userId, email: session.user.email };
}

/** Invalidates a session (logout). Safe to call with an already-invalid token. */
export async function destroySession(sessionToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(sessionToken) } });
}
