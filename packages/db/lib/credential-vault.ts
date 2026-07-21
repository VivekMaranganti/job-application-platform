// ---------------------------------------------------------------------------
// The credential vault: the only module allowed to read or write portal
// passwords.
//
// This file follows the same "one chokepoint" pattern the apply-agent uses
// for status writes (db/status.ts) and log rows (db/log-writer.ts): if every
// path in and out of the vault goes through here, then the audit trail,
// the allowlist check, and the encryption boundary can't be bypassed by
// forgetting to call something at a distant call site. Nothing outside this
// module should touch `portal_credentials.password_encrypted`.
//
// Three invariants this module exists to hold:
//
//   1. A password is encrypted before it reaches Postgres, always. There is
//      no code path that writes plaintext, because there is no plaintext
//      column to write to (see schema.prisma).
//   2. A credential row cannot be created for a domain that isn't on the
//      allowlist. The check happens here, at write time, not at the call
//      site -- so a future caller that forgets to check still can't store a
//      credential for a phishing domain.
//   3. Every decryption writes a CredentialRevealEvent row. Reveal and audit
//      happen in the same function, so "read a password without leaving a
//      trace" isn't an available operation.
// ---------------------------------------------------------------------------

// Relative imports here are extensionless, matching the rest of lib/ -- NOT
// the explicit ".ts" style the connectors use. The difference is who
// consumes them: connectors are standalone scripts only node runs, while
// this module is imported by apps/web and apps/apply-agent-service, whose
// tsconfigs reject ".ts" specifiers (and apply-agent-service can't enable
// them, since allowImportingTsExtensions requires noEmit and that package
// builds to dist/). Anything under lib/ has to stay extensionless for that
// reason. scripts/smoke-test-vault.ts is run with tsx rather than bare node
// precisely because of this.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "./client";
import {
  decryptField,
  encryptField,
  fromPrismaBytes,
  toPrismaBytes,
  type KeyProvider,
} from "./encryption";
import {
  checkAccountCreationAllowed,
  type AllowlistDecision,
} from "./policy/account-creation-allowlist";
import { generatePassword } from "./password-generator";

/** How long a redeemed reveal challenge keeps the vault unlocked. */
const REVEAL_UNLOCK_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
/** How long an issued (unredeemed) reveal code stays valid. */
const REVEAL_CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes
/**
 * Wrong-code attempts before a challenge is dead.
 *
 * A 6-digit code is 10^6 possibilities. Five attempts against a 10-minute
 * window is a ~1-in-200,000 chance per challenge, and burning a challenge
 * costs the attacker a fresh email round-trip they can't see. That's a wide
 * enough margin without making a fat-fingered code a lockout.
 */
const MAX_REVEAL_CHALLENGE_ATTEMPTS = 5;

/** Credential metadata safe to return to the client. Note: no password. */
export interface CredentialSummary {
  id: string;
  domain: string;
  siteName: string;
  originHostname: string;
  username: string;
  createdByAgent: boolean;
  createdAt: Date;
  lastRevealedAt: Date | null;
}

/**
 * Salted hash for reveal codes.
 *
 * The user id is mixed in rather than hashing the bare code. Two reasons:
 * `reveal_challenges.code_hash` carries a global UNIQUE constraint, and a
 * 6-digit code space is small enough that two users holding the same code
 * concurrently is a live possibility (birthday collision over 10^6, not the
 * negligible odds you get with the 32-byte tokens in lib/auth.ts) -- an
 * unsalted hash would turn that into an insert failure for whoever asked
 * second. Mixing in the user id also means a stolen `code_hash` can't be
 * matched against a precomputed table of all million codes.
 */
function hashRevealCode(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

/** Constant-time compare, so a wrong code can't be narrowed down by timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Writing credentials
// ---------------------------------------------------------------------------

export interface SaveCredentialInput {
  userId: string;
  /** Full URL of the signup/login page. Allowlist-checked before any write. */
  url: string;
  username: string;
  /**
   * Password to store. Omit to have one generated -- the normal path when
   * the agent is registering an account it just created.
   */
  password?: string;
  /** False when the user is saving an account they made themselves. */
  createdByAgent?: boolean;
}

export type SaveCredentialResult =
  | { ok: true; credential: CredentialSummary; password: string }
  | { ok: false; decision: Extract<AllowlistDecision, { allowed: false }> };

/**
 * Stores (or rotates) the credential for one ATS account.
 *
 * Returns the plaintext password to the *caller* -- the agent needs it to
 * finish typing the signup form it's in the middle of, and the UI shows it
 * once at creation. This is the only function that returns a password
 * without writing an audit row, because at this moment the caller is the
 * party that just generated it; there's nothing yet to audit reading.
 *
 * Denial is returned, not thrown: "this domain isn't allowed" is an expected
 * outcome the agent handles by yielding to the human, not an exception.
 */
export async function saveCredential(
  input: SaveCredentialInput,
  keyProvider?: KeyProvider,
): Promise<SaveCredentialResult> {
  const decision = checkAccountCreationAllowed(input.url);
  if (!decision.allowed) {
    return { ok: false, decision };
  }

  const username = input.username.trim();
  if (!username) throw new Error("A username is required to save a credential.");

  const password = input.password ?? generatePassword();
  const encrypted = await encryptField(password, keyProvider);
  // encryptField only returns null for null/undefined input; `password` is a
  // non-nullable string by this point.
  if (!encrypted) throw new Error("Encryption produced no ciphertext.");
  const passwordEncrypted = toPrismaBytes(encrypted);

  const row = await prisma.portalCredential.upsert({
    where: {
      userId_domain_username: {
        userId: input.userId,
        domain: decision.domain,
        username,
      },
    },
    update: {
      passwordEncrypted,
      originHostname: decision.hostname,
      siteName: decision.siteName,
    },
    create: {
      userId: input.userId,
      domain: decision.domain,
      siteName: decision.siteName,
      originHostname: decision.hostname,
      username,
      passwordEncrypted,
      createdByAgent: input.createdByAgent ?? true,
    },
  });

  return { ok: true, credential: toSummary(row), password };
}

function toSummary(row: {
  id: string;
  domain: string;
  siteName: string;
  originHostname: string;
  username: string;
  createdByAgent: boolean;
  createdAt: Date;
  lastRevealedAt: Date | null;
}): CredentialSummary {
  return {
    id: row.id,
    domain: row.domain,
    siteName: row.siteName,
    originHostname: row.originHostname,
    username: row.username,
    createdByAgent: row.createdByAgent,
    createdAt: row.createdAt,
    lastRevealedAt: row.lastRevealedAt,
  };
}

// ---------------------------------------------------------------------------
// Reading credentials
// ---------------------------------------------------------------------------

/**
 * Lists a user's saved accounts, without decrypting anything.
 *
 * The `select` below is explicit rather than a bare `findMany()` on purpose:
 * a default query returns every column, which would pull
 * `passwordEncrypted` into the API layer's memory for every row on every
 * page load, where the next person to write `return NextResponse.json(rows)`
 * would ship all of it to the browser. Not selecting it means it isn't there
 * to leak.
 */
export async function listCredentials(userId: string): Promise<CredentialSummary[]> {
  const rows = await prisma.portalCredential.findMany({
    where: { userId },
    select: {
      id: true,
      domain: true,
      siteName: true,
      originHostname: true,
      username: true,
      createdByAgent: true,
      createdAt: true,
      lastRevealedAt: true,
    },
    orderBy: [{ siteName: "asc" }, { username: "asc" }],
  });
  return rows.map(toSummary);
}

export interface RevealContext {
  /** "ui" for a human clicking Reveal, "agent" for an automated login. */
  revealedBy: "ui" | "agent";
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Decrypts one password and records that it happened.
 *
 * The tenant check is part of the `where` clause rather than a fetch-then-
 * compare, so a mismatched userId returns nothing instead of returning a row
 * that a later `if` is responsible for rejecting.
 *
 * Callers in the web app must gate this behind `isRevealUnlocked` -- this
 * function does not check the unlock window itself, because the apply-agent
 * calls it too and has no browser session to have unlocked. Keeping the
 * session-shaped check in the route rather than here is why `revealedBy`
 * exists: the audit row records which of the two paths was used.
 */
export async function revealCredential(
  userId: string,
  credentialId: string,
  context: RevealContext,
  keyProvider?: KeyProvider,
): Promise<{ credential: CredentialSummary; password: string } | null> {
  const row = await prisma.portalCredential.findFirst({
    where: { id: credentialId, userId },
  });
  if (!row) return null;

  const password = await decryptField(fromPrismaBytes(row.passwordEncrypted), keyProvider);
  if (password === null) {
    throw new Error("Stored credential has no ciphertext -- the row is corrupt.");
  }

  const [updated] = await prisma.$transaction([
    prisma.portalCredential.update({
      where: { id: row.id },
      data: { lastRevealedAt: new Date() },
    }),
    prisma.credentialRevealEvent.create({
      data: {
        credentialId: row.id,
        userId,
        revealedBy: context.revealedBy,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    }),
  ]);

  return { credential: toSummary(updated), password };
}

/**
 * Finds an existing credential for whatever ATS `url` belongs to, and
 * decrypts it — the apply-agent's "do I already have an account here?" path.
 *
 * Matching is on the registrable domain, which is the point of storing
 * eTLD+1 rather than the full hostname: one Workday account works across
 * every `<employer>.myworkdayjobs.com` tenant, so the agent shouldn't
 * register a fresh account for each employer it encounters.
 *
 * Runs through the allowlist first even though it's only reading. A URL
 * that isn't allowlisted has no business being matched against the vault at
 * all — if a page at `greenhouse.io.evil.com` could ask "what's my
 * greenhouse credential?", the allowlist on the *write* path wouldn't
 * matter, because the read path would hand over the same password.
 *
 * Writes a `revealedBy: "agent"` audit row, same as a UI reveal. Agent
 * logins are exactly the thing you'd want visible when reviewing where a
 * credential has been used.
 */
export async function findCredentialForUrl(
  userId: string,
  url: string,
  keyProvider?: KeyProvider,
): Promise<{ credential: CredentialSummary; password: string } | null> {
  const decision = checkAccountCreationAllowed(url);
  if (!decision.allowed) return null;

  const row = await prisma.portalCredential.findFirst({
    where: { userId, domain: decision.domain },
    orderBy: { createdAt: "asc" },
  });
  if (!row) return null;

  return revealCredential(userId, row.id, { revealedBy: "agent" }, keyProvider);
}

/** Deletes a saved credential. Cascades its reveal-log rows. */
export async function deleteCredential(userId: string, credentialId: string): Promise<boolean> {
  const { count } = await prisma.portalCredential.deleteMany({
    where: { id: credentialId, userId },
  });
  return count > 0;
}

/** Recent reveal history for one user, newest first. Never includes values. */
export async function listRevealEvents(userId: string, limit = 50) {
  return prisma.credentialRevealEvent.findMany({
    where: { userId },
    orderBy: { timestamp: "desc" },
    take: limit,
    include: { credential: { select: { siteName: true, username: true } } },
  });
}

// ---------------------------------------------------------------------------
// Re-authentication (the reveal challenge)
// ---------------------------------------------------------------------------

/**
 * Issues a fresh 6-digit reveal code and returns it raw.
 *
 * The caller emails it; only the salted hash is persisted. Any outstanding
 * unconsumed challenges for this user are deleted first, so a user who
 * clicks "unlock" three times has exactly one live code (the newest) rather
 * than three independently-guessable ones.
 *
 * Why a 6-digit code and not a magic link like login: the reveal flow's
 * whole point is that the person is *at* the browser right now. A link
 * opens a new tab and a new session; a code gets typed into the page that's
 * already open, keeping the unlock tied to the session that asked for it.
 */
export async function createRevealChallenge(userId: string): Promise<string> {
  await prisma.revealChallenge.deleteMany({ where: { userId, consumedAt: null } });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.revealChallenge.create({
    data: {
      userId,
      codeHash: hashRevealCode(userId, code),
      expiresAt: new Date(Date.now() + REVEAL_CHALLENGE_TTL_MS),
    },
  });
  return code;
}

export type RedeemResult =
  | { ok: true; unlockedUntil: Date }
  | { ok: false; reason: "no_challenge" | "expired" | "too_many_attempts" | "wrong_code" };

/**
 * Redeems a reveal code, opening the unlock window.
 *
 * A wrong code increments `failedAttempts` on the live challenge rather than
 * being a no-op, which is what makes MAX_REVEAL_CHALLENGE_ATTEMPTS bite. All
 * four failure reasons are returned to the caller, but the route deliberately
 * collapses them before responding -- see the reveal route's note.
 */
export async function redeemRevealChallenge(userId: string, code: string): Promise<RedeemResult> {
  const challenge = await prisma.revealChallenge.findFirst({
    where: { userId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return { ok: false, reason: "no_challenge" };
  if (challenge.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (challenge.failedAttempts >= MAX_REVEAL_CHALLENGE_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  if (!safeEqual(challenge.codeHash, hashRevealCode(userId, code.trim()))) {
    await prisma.revealChallenge.update({
      where: { id: challenge.id },
      data: { failedAttempts: { increment: 1 } },
    });
    return { ok: false, reason: "wrong_code" };
  }

  const unlockedUntil = new Date(Date.now() + REVEAL_UNLOCK_WINDOW_MS);
  await prisma.revealChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date(), unlockedUntil },
  });
  return { ok: true, unlockedUntil };
}

/**
 * True while the user holds an unexpired unlock window.
 *
 * Checked server-side on every reveal. The client also tracks the window to
 * grey out the buttons, but that's presentation only -- the client's copy of
 * the deadline is a hint, and this query is the actual gate.
 */
export async function isRevealUnlocked(userId: string): Promise<boolean> {
  const active = await prisma.revealChallenge.findFirst({
    where: { userId, consumedAt: { not: null }, unlockedUntil: { gt: new Date() } },
  });
  return active !== null;
}

/** The current unlock deadline, or null if locked. Drives the UI countdown. */
export async function getRevealUnlockedUntil(userId: string): Promise<Date | null> {
  const active = await prisma.revealChallenge.findFirst({
    where: { userId, consumedAt: { not: null }, unlockedUntil: { gt: new Date() } },
    orderBy: { unlockedUntil: "desc" },
  });
  return active?.unlockedUntil ?? null;
}

export { REVEAL_UNLOCK_WINDOW_MS, MAX_REVEAL_CHALLENGE_ATTEMPTS };
