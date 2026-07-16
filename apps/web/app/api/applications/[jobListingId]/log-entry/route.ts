import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireUserId } from "@/lib/require-user";
import type { LogEntrySource } from "@/lib/types";

// ---------------------------------------------------------------------------
// Activity log writes (issue #6), for the apply agent to call as it fills
// out an application. See app/api/activity-log/route.ts (read side) for the
// trust model this follows: entries are self-reported by whoever actually
// performed the action, same as apps/apply-agent-service's log-writer.ts
// would have been for the hosted-service path -- there's no independent
// verification of "this really happened" beyond the caller being an
// authenticated session for the user the entry is filed under.
//
// This route is intentionally narrow: it can only create entries for an
// Application that already belongs to the caller (repository.getApplication
// / createApplicationLogEntry both re-check userId, not just this route),
// and `value_category` is always a caller-supplied *label*, never
// free-text -- see lib/types.ts ApplicationLogEntry's doc comment. A caller
// cannot smuggle a raw answer value through this endpoint; there's no field
// here that accepts one.
// ---------------------------------------------------------------------------

interface LogEntryPostBody {
  field_label: string;
  value_category: string;
  source: LogEntrySource;
}

const VALID_SOURCES: LogEntrySource[] = ["auto", "user-provided-live"];

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/applications/[jobListingId]/log-entry">
) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const { jobListingId } = await ctx.params;

  const application = await repository.getApplication(userId, jobListingId);
  if (!application) {
    return NextResponse.json({ error: "No application in progress for this job listing." }, { status: 404 });
  }

  const body = (await request.json()) as Partial<LogEntryPostBody>;
  if (!body.field_label || !body.value_category || !body.source) {
    return NextResponse.json({ error: "field_label, value_category, and source are required." }, { status: 400 });
  }
  if (!VALID_SOURCES.includes(body.source)) {
    return NextResponse.json({ error: `source must be one of: ${VALID_SOURCES.join(", ")}` }, { status: 400 });
  }

  const jobListings = await repository.listJobListings();
  const job = jobListings.find((j) => j.id === jobListingId);

  const entry = await repository.createApplicationLogEntry(userId, {
    application_id: application.id,
    field_label: body.field_label,
    value_category: body.value_category,
    sent_to: job?.company ?? jobListingId,
    source: body.source,
  });
  return NextResponse.json(entry);
}
