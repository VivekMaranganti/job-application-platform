import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { getCurrentUserId } from "@/lib/current-user";
import type { ApplicationStatus } from "@/lib/types";

export async function GET() {
  const userId = getCurrentUserId();
  const applications = await repository.listApplications(userId);
  return NextResponse.json(applications);
}

interface ApplicationPostBody {
  job_listing_id: string;
  status: ApplicationStatus;
}

// Creates or updates the caller's Application for a job listing (e.g.
// "Apply" -> reviewing, "Skip" -> skipped). See
// app/api/applications/[id]/simulate-submit/route.ts for the stub that
// stands in for issue #4's real apply agent.
export async function POST(request: Request) {
  const userId = getCurrentUserId();
  const body = (await request.json()) as ApplicationPostBody;
  if (!body.job_listing_id || !body.status) {
    return NextResponse.json({ error: "job_listing_id and status are required" }, { status: 400 });
  }
  const application = await repository.upsertApplicationStatus(userId, body.job_listing_id, body.status);
  return NextResponse.json(application);
}

// Removes the caller's Application for a job listing entirely (used by
// "Skip -> Undo" and "cancel review" to return a job to its unactioned
// state, matching the prototype's idle status).
export async function DELETE(request: Request) {
  const userId = getCurrentUserId();
  const jobListingId = new URL(request.url).searchParams.get("job_listing_id");
  if (!jobListingId) {
    return NextResponse.json({ error: "job_listing_id query param is required" }, { status: 400 });
  }
  await repository.deleteApplication(userId, jobListingId);
  return NextResponse.json({ ok: true });
}
