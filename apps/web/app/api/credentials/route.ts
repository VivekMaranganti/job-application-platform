import { NextResponse } from "next/server";
import {
  listCredentials,
  saveCredential,
  getRevealUnlockedUntil,
  checkAccountCreationAllowed,
} from "auto-job-applier-db";
import { requireUserId } from "@/lib/require-user";

// ---------------------------------------------------------------------------
// GET  /api/credentials  -> the user's saved ATS accounts, metadata only.
// POST /api/credentials  -> save (or rotate) one account's credentials.
//
// The response shape here is the whole security story for this endpoint:
// it contains no passwords and no ciphertext, and it can't, because
// `listCredentials` doesn't select the column (see credential-vault.ts).
// Passwords come back from exactly one other route -- the reveal endpoint --
// which requires a fresh re-auth and writes an audit row.
// ---------------------------------------------------------------------------

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const [credentials, unlockedUntil] = await Promise.all([
    listCredentials(userId),
    getRevealUnlockedUntil(userId),
  ]);

  return NextResponse.json({
    credentials,
    // The client uses this to render the countdown and disable Reveal once
    // it lapses. It is a display hint only -- the reveal route re-checks
    // server-side and does not trust the client's view of the clock.
    unlocked_until: unlockedUntil?.toISOString() ?? null,
  });
}

interface SaveBody {
  url?: string;
  username?: string;
  /** Omit to have a strong password generated. */
  password?: string;
  created_by_agent?: boolean;
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = (await request.json().catch(() => ({}))) as SaveBody;
  const url = body.url?.trim();
  const username = body.username?.trim();

  if (!url || !username) {
    return NextResponse.json({ error: "Both url and username are required." }, { status: 400 });
  }

  // Checked here as well as inside saveCredential so the 403 carries the
  // specific reason (which the UI shows verbatim). saveCredential re-checks
  // regardless -- this is a better error message, not the actual gate.
  const decision = checkAccountCreationAllowed(url);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: decision.detail, reason: decision.reason },
      { status: 403 },
    );
  }

  const result = await saveCredential({
    userId,
    url,
    username,
    password: body.password,
    createdByAgent: body.created_by_agent ?? false,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.decision.detail, reason: result.decision.reason },
      { status: 403 },
    );
  }

  // The password is returned exactly once, here, at the moment of creation --
  // the user needs to see a generated password to be able to use it, and the
  // caller already knows a supplied one. Every subsequent read goes through
  // the audited reveal route.
  return NextResponse.json({ credential: result.credential, password: result.password });
}
