import { NextResponse } from "next/server";
import { createRevealChallenge, redeemRevealChallenge } from "auto-job-applier-db";
import { getCurrentUser } from "@/lib/current-user";

// ---------------------------------------------------------------------------
// The re-authentication step in front of password reveals.
//
// POST /api/credentials/unlock            -> email a 6-digit code
// POST /api/credentials/unlock?redeem=1   -> exchange the code for a window
//
// Why this exists at all: the app's session cookie lasts 30 days (see
// apps/web/AUTH.md). That's a sensible bar for browsing your job feed and a
// bad one for reading back every password you own -- at 30 days, "someone
// borrowed the laptop" is enough. Magic-link auth gives us no account
// password to re-prompt for, so re-authenticating means re-proving control
// of the email address on file.
//
// Same stub as the login route: there's no email provider configured in this
// repo, so the code is console.logged and (outside production only) returned
// in the response so the flow is exercisable. That branch is hard-disabled
// in production rather than env-flagged, because returning the code there
// would reduce this whole mechanism to a formality -- anyone holding a
// stolen session cookie could unlock the vault by calling this route twice.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const isRedeem = new URL(request.url).searchParams.get("redeem") === "1";
  const isProduction = process.env.NODE_ENV === "production";

  if (!isRedeem) {
    const code = await createRevealChallenge(user.id);

    // Dev-only, unlike the login route's equivalent log line. A magic-link
    // URL in a log is bad; a vault-unlock code in a log is worse, because
    // anyone who can read stdout (a log aggregator, a CI artifact, a
    // sidecar) could pair it with a stolen session cookie and read every
    // password. Since there's no email provider wired up, the practical
    // effect is that this flow is not usable in production yet -- which is
    // the correct failure mode. Wire a real provider before deploying.
    if (!isProduction) {
      console.log(`[vault] Reveal code for ${user.email}: ${code}`);
    }

    return NextResponse.json({
      ok: true,
      message: isProduction
        ? `We sent a 6-digit code to ${user.email}. It expires in 10 minutes.`
        : "Dev mode: no email is sent. Use devCode below.",
      ...(isProduction ? {} : { devCode: code }),
    });
  }

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "A code is required." }, { status: 400 });
  }

  const result = await redeemRevealChallenge(user.id, code);
  if (!result.ok) {
    // The four internal reasons collapse to two responses on purpose.
    // "expired", "no_challenge" and "wrong_code" are deliberately
    // indistinguishable to the caller: telling someone holding a stolen
    // session which of those applies tells them whether a code is currently
    // outstanding and worth guessing. "too_many_attempts" is surfaced
    // because the user needs to know retrying is pointless and they should
    // request a fresh code.
    const tooMany = result.reason === "too_many_attempts";
    return NextResponse.json(
      {
        error: tooMany
          ? "Too many incorrect attempts. Request a new code."
          : "That code isn't valid. Request a new one if it's been more than 10 minutes.",
        reason: tooMany ? "too_many_attempts" : "invalid",
      },
      { status: tooMany ? 429 : 400 },
    );
  }

  return NextResponse.json({ ok: true, unlocked_until: result.unlockedUntil.toISOString() });
}
