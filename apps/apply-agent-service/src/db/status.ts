import { prisma, ApplicationStatus as PrismaApplicationStatus } from "auto-job-applier-db";

// ---------------------------------------------------------------------------
// The ONE module allowed to write Application.status. This is where the
// "never auto-submit" requirement is enforced as a structural invariant,
// not a convention:
//
//   - `advanceStatus`'s type signature statically excludes "submitted" as a
//     legal argument, so no field-filling/automation code path can even
//     compile a call that submits.
//   - `markSubmitted` takes no status parameter at all (the transition it
//     performs is hardcoded), re-checks in the same query that the current
//     status is READY_FOR_REVIEW (via the `where` clause, not a separate
//     read-then-write race), and is only ever called from
//     session/apply-session.ts's `confirmSubmit`, which itself is only
//     reachable from the WS control handler's `confirm_submit` case -- i.e.
//     an explicit message that arrived from the connected human reviewer.
//
// No other module in this service imports `prisma.application.update`
// directly for status changes.
// ---------------------------------------------------------------------------

export type NonSubmittedStatus = Exclude<
  "matched" | "reviewing" | "in_progress" | "needs_input" | "ready_for_review" | "skipped" | "failed",
  "submitted"
>;

const TO_PRISMA_STATUS: Record<NonSubmittedStatus, PrismaApplicationStatus> = {
  matched: PrismaApplicationStatus.MATCHED,
  reviewing: PrismaApplicationStatus.REVIEWING,
  in_progress: PrismaApplicationStatus.IN_PROGRESS,
  needs_input: PrismaApplicationStatus.NEEDS_INPUT,
  ready_for_review: PrismaApplicationStatus.READY_FOR_REVIEW,
  skipped: PrismaApplicationStatus.SKIPPED,
  failed: PrismaApplicationStatus.FAILED,
};

export class NotReadyForReviewError extends Error {
  constructor(applicationId: string) {
    super(
      `Application ${applicationId} is not in ready_for_review status -- refusing to submit. ` +
        `This should be structurally unreachable: confirmSubmit() must not be callable before ready_for_review.`,
    );
    this.name = "NotReadyForReviewError";
  }
}

/** Any non-submit status transition (matched -> ... -> ready_for_review, or -> skipped / failed). */
export async function advanceStatus(
  userId: string,
  applicationId: string,
  status: NonSubmittedStatus,
): Promise<void> {
  await prisma.application.update({
    where: { id: applicationId, userId },
    data: { status: TO_PRISMA_STATUS[status] },
  });
}

/**
 * The only function in this service that can set status = SUBMITTED. Scoped
 * (in the `where` clause) to rows currently in READY_FOR_REVIEW so a
 * concurrent/duplicate call can't double-submit or submit from an
 * unexpected state -- if zero rows match, that's treated as the invariant
 * having been violated upstream and surfaced as an error rather than
 * silently no-opping.
 */
export async function markSubmitted(userId: string, applicationId: string): Promise<Date> {
  const submittedAt = new Date();
  const result = await prisma.application.updateMany({
    where: { id: applicationId, userId, status: PrismaApplicationStatus.READY_FOR_REVIEW },
    data: { status: PrismaApplicationStatus.SUBMITTED, submittedAt },
  });
  if (result.count === 0) {
    throw new NotReadyForReviewError(applicationId);
  }
  return submittedAt;
}
