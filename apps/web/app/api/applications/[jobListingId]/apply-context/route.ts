import { NextResponse } from "next/server";
import { isCriminalHistoryAutoModeAllowed, parseJurisdiction } from "auto-job-applier-db";
import { repository } from "@/lib/repository";
import { requireUserId } from "@/lib/require-user";
import { getCurrentUser } from "@/lib/current-user";
import { REQUIRED_FIELDS, type RequiredFieldId } from "@/lib/types";

// ---------------------------------------------------------------------------
// Everything needed to actually fill out one application, in one call. This
// is what the apply agent reads before driving a browser (via Claude in
// Chrome, in a live session with the user) -- see packages/db/lib/policy/
// README.md and apps/apply-agent-service for the equivalent context-loading
// logic on the (currently unused for personal use) hosted-service path.
//
// PRIVACY-CRITICAL, same rule as apps/apply-agent-service/src/db/context.ts:
// a required-info field's `value` is only ever populated when `mode ===
// "auto"`. Manual-mode fields always come back with `value: null` here --
// regardless of whether a value happens to be stored -- so whoever/whatever
// reads this response structurally cannot see a manual-mode answer; the
// human must supply it live. This is enforced in this one function, not
// left to callers to remember. criminal_history gets an additional gate on
// top of that (see below) even though, as of this writing, it can never
// actually reach here with mode="auto" -- see resolveRequiredInfoModeForSave.
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/applications/[jobListingId]/apply-context">
) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const { jobListingId } = await ctx.params;

  const [user, application, jobListings, profile, filters, answers] = await Promise.all([
    getCurrentUser(),
    repository.getApplication(userId, jobListingId),
    repository.listJobListings(),
    repository.getProfile(userId),
    repository.getFilters(userId),
    repository.getRequiredInfoAnswers(userId),
  ]);

  const jobListing = jobListings.find((j) => j.id === jobListingId);
  if (!jobListing) {
    return NextResponse.json({ error: "No such job listing." }, { status: 404 });
  }
  if (!application) {
    return NextResponse.json(
      { error: "No application in progress for this job listing. Create one (status: reviewing) first." },
      { status: 404 }
    );
  }

  const jurisdiction = parseJurisdiction(jobListing.location);
  const answerByField = new Map(answers.map((a) => [a.field_id, a]));

  const requiredInfo = REQUIRED_FIELDS.map((field) => {
    const answer = answerByField.get(field.id);
    const mode = answer?.mode ?? "manual";
    const criminalHistoryCleared =
      field.id !== "criminal_history" || isCriminalHistoryAutoModeAllowed(jurisdiction);
    // Same structural rule as apps/apply-agent-service's field-matcher.ts:
    // manual mode (or an unreviewed criminal_history jurisdiction) means no
    // value crosses this boundary, full stop.
    const value = mode === "auto" && criminalHistoryCleared ? answer!.value : null;
    return {
      field_id: field.id as RequiredFieldId,
      label: field.label,
      question: field.question,
      type: field.type,
      options: field.options ?? null,
      caution: field.caution ?? null,
      mode: mode === "auto" && !criminalHistoryCleared ? ("manual" as const) : mode,
      value,
    };
  });

  const resumeLocalPath = profile.resume_file_name ? await repository.getResumeFilePath(userId) : null;

  return NextResponse.json({
    application: { id: application.id, status: application.status },
    job_listing: {
      id: jobListing.id,
      title: jobListing.title,
      company: jobListing.company,
      location: jobListing.location,
      url: jobListing.url,
      employment_type: jobListing.employment_type,
      remote_type: jobListing.remote_type,
    },
    profile: {
      full_name: profile.full_name,
      phone: profile.phone,
      // Falls back to the account's login email when no separate contact
      // email is set -- this is the one place that fallback happens (see
      // apps/web/lib/repository/postgres.ts toDomainProfile's note).
      contact_email: profile.contact_email ?? user?.email ?? null,
      linkedin_url: profile.linkedin_url,
      portfolio_url: profile.portfolio_url,
      locations: profile.locations,
      levels: profile.levels,
      target_titles: profile.target_titles,
      resume: profile.resume_file_name
        ? {
            file_name: profile.resume_file_name,
            // Absolute path on local disk -- only present because this app
            // runs entirely on the user's own machine for personal use (see
            // packages/db/lib/resume-storage.ts). Null if resume storage
            // isn't a local-disk backend (e.g. a future S3 setup); in that
            // case, fall back to downloading the file another way.
            local_path: resumeLocalPath,
          }
        : null,
    },
    filters: {
      special_instructions: filters.special_instructions,
      exclude_companies: filters.exclude_companies,
    },
    required_info: requiredInfo,
  });
}
