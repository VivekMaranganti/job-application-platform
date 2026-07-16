import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";

/**
 * Resolves the current request's user id for an API route, or a
 * ready-to-return 401 response if signed out. Every user-scoped route
 * handler under app/api/ uses this instead of calling getCurrentUserId()
 * directly, so "not authenticated" is handled the same way everywhere:
 *
 *   const userId = await requireUserId();
 *   if (userId instanceof NextResponse) return userId;
 */
export async function requireUserId(): Promise<string | NextResponse> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  return userId;
}
