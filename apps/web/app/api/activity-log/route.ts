import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireUserId } from "@/lib/require-user";

// ---------------------------------------------------------------------------
// Activity log (issue #6).
//
// This file is read-only -- writes live in
// app/api/applications/[jobListingId]/log-entry/route.ts, scoped per
// application on purpose (see that file's header for the trust model: an
// entry is self-reported by whoever performed the action, same as it would
// have been from the hosted apply-agent service). There's no unscoped
// "write any entry" route, and value_category is always a caller-supplied
// label, never free text -- see lib/types.ts ApplicationLogEntry's doc
// comment for why a raw answer value can never travel through this system.
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
