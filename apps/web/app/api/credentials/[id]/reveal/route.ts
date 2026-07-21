import { NextResponse } from "next/server";
import { isRevealUnlocked, revealCredential } from "auto-job-applier-db";
import { requireUserId } from "@/lib/require-user";

// ---------------------------------------------------------------------------
// POST /api/credentials/:id/reveal -> decrypt and return ONE password.
//
// This is the only route in the app that returns a portal password after
// creation. Three things gate it, in this order:
//
//   1. A valid session (requireUserId).
//   2. An unexpired unlock window from /api/credentials/unlock. Checked here,
//      server-side, on every call -- the client's countdown is cosmetic.
//   3. Tenant scoping inside revealCredential's `where` clause, so another
//      user's credential id returns 404 rather than a row we then have to
//      remember to reject.
//
// One credential per call, by id. There is deliberately no "reveal all"
// variant and no query parameter that turns this into one: a bulk endpoint
// would make a single stolen request equivalent to dumping the vault, and
// would collapse the audit trail from "which password was read, when" into
// a single uninformative row.
// ---------------------------------------------------------------------------

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  if (!(await isRevealUnlocked(userId))) {
    return NextResponse.json(
      {
        error: "Confirm it's you before revealing a password.",
        reason: "locked",
      },
      { status: 403 },
    );
  }

  const { id } = await params;

  // Recorded on the audit row so a reveal from an unfamiliar address or
  // browser is visible after the fact. `x-forwarded-for` is only meaningful
  // behind a proxy that sets it and is trivially spoofable otherwise -- it's
  // stored as a weak hint for the user reading their own history, and
  // nothing in this codebase makes an access-control decision from it.
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress = forwarded?.split(",")[0]?.trim() ?? null;

  const result = await revealCredential(userId, id, {
    revealedBy: "ui",
    ipAddress,
    userAgent: request.headers.get("user-agent"),
  });

  if (!result) {
    return NextResponse.json({ error: "Credential not found." }, { status: 404 });
  }

  return NextResponse.json({
    password: result.password,
    credential: result.credential,
  });
}
