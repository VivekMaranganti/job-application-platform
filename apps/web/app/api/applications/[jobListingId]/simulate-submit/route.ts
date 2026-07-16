import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { getCurrentUserId } from "@/lib/current-user";
import { REQUIRED_FIELDS } from "@/lib/types";

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
// Activity Log (issue #6): this route now writes one ApplicationLogEntry
// per field that would have been auto-submitted (i.e. every
// RequiredInfoAnswer with mode "auto"), plus one for the resume if uploaded.
// Per the schema's privacy rule, `value_category` is always the field's
// short id (e.g. "work_auth") -- never the actual answer -- so no sensitive
// value is ever read out of RequiredInfoAnswer here, only which fields were
// marked auto and whether a resume exists. Entries with
// source: "user-provided-live" (fields the user was prompted for live) will
// come from issue #4's real apply agent, which actually observes that
// interaction -- this stub never fabricates those.
// ---------------------------------------------------------------------------
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/applications/[jobListingId]/simulate-submit">
) {
  const userId = getCurrentUserId();
  const { jobListingId } = await ctx.params;

  const existing = await repository.getApplication(userId, jobListingId);
  if (!existing) {
    return NextResponse.json({ error: "No application in progress for this job listing." }, { status: 404 });
  }

  const application = await repository.upsertApplicationStatus(userId, jobListingId, "submitted");

  const [jobListings, profile, answers] = await Promise.all([
    repository.listJobListings(),
    repository.getProfile(userId),
    repository.getRequiredInfoAnswers(userId),
  ]);
  const job = jobListings.find((j) => j.id === jobListingId);
  const sentTo = job?.company ?? jobListingId;

  const autoAnswersByField = new Map(
    answers.filter((a) => a.mode === "auto").map((a) => [a.field_id, a])
  );
  const logWrites: Promise<unknown>[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!autoAnswersByField.has(field.id)) continue;
    logWrites.push(
      repository.createApplicationLogEntry(userId, {
        application_id: application.id,
        field_label: field.label,
        value_category: field.id, // coarse category only -- never the raw answer
        sent_to: sentTo,
        source: "auto",
      })
    );
  }
  if (profile.resume_file_name) {
    logWrites.push(
      repository.createApplicationLogEntry(userId, {
        application_id: application.id,
        field_label: "Resume",
        value_category: "resume", // coarse category only -- never the file contents/URL
        sent_to: sentTo,
        source: "auto",
      })
    );
  }
  await Promise.all(logWrites);

  return NextResponse.json({
    application,
    note: "Simulated — the real apply agent (issue #4) is not connected yet. Nothing was actually submitted anywhere.",
  });
}
