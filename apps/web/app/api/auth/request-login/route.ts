import { NextResponse } from "next/server";
import { requestLogin } from "@/lib/auth";

interface RequestLoginBody {
  email?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Step 1 of the magic-link flow: issue a single-use login token for `email`
// (creating the `users` row on first use -- see lib/auth.ts requestLogin).
//
// There is no email-sending integration configured anywhere in this repo
// (no SMTP/SES/Postmark credentials, nothing testable end-to-end in this
// sandbox), so "sending the email" is stubbed as a console.log of the link
// -- proportionate for an early-stage app with no deployment target chosen
// yet. Wiring a real provider is a follow-up (see AUTH.md), and is the same
// shape of "pluggable, not yet chosen" decision as ResumeStorage/KeyProvider
// in packages/db.
//
// The link itself is ONLY returned in the JSON response outside production,
// so this route can be exercised (curl, or the /login page) without a real
// inbox. Returning it in production would let anyone log in as anyone just
// by knowing their email address -- so that branch is hard-disabled there,
// not just hidden by an env flag the caller could override.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as RequestLoginBody;
  const email = body.email?.trim();

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  const { token } = await requestLogin(email);
  const origin = new URL(request.url).origin;
  const loginUrl = `${origin}/api/auth/verify?token=${token}`;

  // Stand-in for a real email send -- see comment above.
  console.log(`[auth] Magic login link for ${email}: ${loginUrl}`);

  const isProduction = process.env.NODE_ENV === "production";
  return NextResponse.json({
    ok: true,
    message: isProduction
      ? "Check your email for a login link."
      : "Dev mode: no email is actually sent. Use devLoginUrl below to sign in.",
    ...(isProduction ? {} : { devLoginUrl: loginUrl }),
  });
}
