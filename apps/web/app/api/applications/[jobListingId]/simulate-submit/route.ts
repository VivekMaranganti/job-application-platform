import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireUserId } from "@/lib/require-user";

// ---------------------------------------------------------------------------
// TODO(issue #4 — Apply agent, not this issue's scope): this is a stub.
//
// There is no live browser session or real form-filling here. Confirming an
// application in the Job Feed tab calls this route, which just marks the
// Application's status as "submitted" (with submitted_at set) so the UI has
// something honest to show ("simulated — apply agent not yet connected")
// and so Application.status already has the lifecycle field issue #4's real
// agent will drive through in_progress -> needs_input -> ready_for_review ->
// submitted / failed.
//
// Also not implemented here: writing an ApplicationLogEntry row (issue #6,
// Activity Log). That table exists in packages/db's schema but nothing
// writes to it yet — see the Activity Log TODO in components/tabs.
// ---------------------------------------------------------------------------
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/applications/[jobListingId]/simulate-submit">
) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const { jobListingId } = await ctx.params;

  const existing = await repository.getApplication(userId, jobListingId);
  if (!existing) {
    return NextResponse.json({ error: "No application in progress for this job listing." }, { status: 404 });
  }

  const application = await repository.upsertApplicationStatus(userId, jobListingId, "submitted");
  return NextResponse.json({
    application,
    note: "Simulated — the real apply agent (issue #4) is not connected yet. Nothing was actually submitted anywhere.",
  });
}
