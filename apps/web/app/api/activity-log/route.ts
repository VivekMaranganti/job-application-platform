import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireUserId } from "@/lib/require-user";

// ---------------------------------------------------------------------------
// Activity log (issue #6).
//
// Read-only from the client on purpose -- there is deliberately no POST
// here. Log entries are only ever written server-side (see
// app/api/applications/[jobListingId]/simulate-submit/route.ts, and
// eventually issue #4's real apply agent), never in response to a client
// request body. That avoids a client being able to fabricate/backdate
// arbitrary entries in its own audit trail, or (worse, if scoping were ever
// misapplied) someone else's.
//
// Always scoped to the caller's userId -- repository.listApplicationLogEntries
// enforces that at the query level, not just here.
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const applicationId = new URL(request.url).searchParams.get("application_id") ?? undefined;
  const entries = await repository.listApplicationLogEntries(userId, applicationId);
  return NextResponse.json(entries);
}
