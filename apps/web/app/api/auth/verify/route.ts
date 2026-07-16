import { NextResponse } from "next/server";
import { consumeLoginToken, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Step 2 of the magic-link flow: consuming the token from the emailed link
// (GET, since it's meant to be followed directly from an email client) mints
// a session and sets it as an httpOnly cookie, then redirects into the app.
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", request.url));
  }

  const result = await consumeLoginToken(token);
  if (!result) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", request.url));
  }

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
