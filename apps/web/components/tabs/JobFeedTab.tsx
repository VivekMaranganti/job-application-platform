"use client";

import { useMemo, useState } from "react";
import { Building2, Check, ChevronDown, ChevronUp, Clock, DollarSign, MapPin, ScrollText } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { useFilters } from "@/hooks/use-filters";
import { useJobFeed } from "@/hooks/use-job-feed";
import { useActivityLog } from "@/hooks/use-activity-log";
import { matchJobs } from "@/lib/match-jobs";
import { REQUIRED_FIELDS, type Application } from "@/lib/types";
import { useRequiredInfo } from "@/hooks/use-required-info";
import { SectionCard, ghostButtonClass, inlineLinkClass, primaryButtonClass } from "@/components/ui/primitives";

const metaClass = "inline-flex items-center gap-1 text-[12.5px] text-muted";

export function JobFeedTab() {
  const { profile, loading: profileLoading } = useProfile();
  const { filters, loading: filtersLoading } = useFilters();
  const { answers } = useRequiredInfo();
  const { jobs, applications, loading: jobsLoading, setStatus, clearStatus, refreshApplications } = useJobFeed();
  const { entriesByApplication, loadingApplicationId, loadEntries } = useActivityLog();
  const [showFilteredOut, setShowFilteredOut] = useState(false);
  const [expandedLogApplicationId, setExpandedLogApplicationId] = useState<string | null>(null);

  const loading = profileLoading || filtersLoading || jobsLoading || !profile || !filters || !jobs;

  const { matched, filtered } = useMemo(() => {
    if (!profile || !filters || !jobs) return { matched: [], filtered: [] };
    return matchJobs(jobs, {
      locations: profile.locations,
      levels: profile.levels,
      titles: profile.target_titles,
      filters: {
        work_arrangement: filters.work_arrangement,
        employment_type: filters.employment_type,
        company_size: filters.company_size,
        salary_min: filters.salary_min,
        date_posted: filters.date_posted,
        industries: filters.industries,
        exclude_companies: filters.exclude_companies,
      },
    });
  }, [profile, filters, jobs]);

  if (loading) {
    return <div className="font-mono text-xs text-muted">Loading job feed…</div>;
  }

  const autoFields = REQUIRED_FIELDS.filter((f) => answers?.[f.id]?.mode === "auto");
  const manualFields = REQUIRED_FIELDS.filter((f) => answers?.[f.id]?.mode !== "auto");

  const toggleActivityLog = (applicationId: string) => {
    if (expandedLogApplicationId === applicationId) {
      setExpandedLogApplicationId(null);
      return;
    }
    setExpandedLogApplicationId(applicationId);
    if (!entriesByApplication[applicationId]) {
      void loadEntries(applicationId);
    }
  };

  return (
    <div>
      <p className="text-[13.5px] text-muted mt-0 mb-1 leading-relaxed">
        Pulled from company career pages via ATS connectors (Greenhouse, Lever, Ashby, Workday). This is seed data
        standing in for live listings until the real connectors are wired up.
      </p>
      <p className="font-mono text-[11px] text-muted/80 mt-0 mb-4.5">
        {matched.length} of {jobs.length} seed postings match your profile and filters
      </p>

      {matched.length === 0 && (
        <SectionCard>
          <div className="text-[13.5px] text-muted">Nothing matched. Try widening your Filters or Profile settings.</div>
        </SectionCard>
      )}

      {matched.map(({ job, reasons }) => {
        const application: Application | undefined = applications[job.id];
        const status = application ? application.status : ("idle" as const);
        return (
          <SectionCard key={job.id}>
            <div className="flex justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold text-[15px] text-ink">{job.title}</div>
                <div className="flex items-center gap-2.5 mt-1 flex-wrap">
                  <span className={metaClass}>
                    <Building2 size={12} /> {job.company}
                  </span>
                  <span className={metaClass}>
                    <MapPin size={12} /> {job.location ?? "Location not listed"}
                    {job.remote_type ? ` · ${job.remote_type}` : ""}
                  </span>
                  {job.salary_max != null && (
                    <span className={metaClass}>
                      <DollarSign size={12} /> {job.salary_min?.toLocaleString()}–{job.salary_max.toLocaleString()}
                    </span>
                  )}
                  {job.date_posted && (
                    <span className={metaClass}>
                      <Clock size={12} /> {new Date(job.date_posted).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <span className="font-mono text-[10px] text-muted self-start">via {job.source_connector}</span>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {reasons.map((r) => (
                <span key={r} className="font-mono text-[10.5px] text-ledger bg-ledger/[0.08] border border-ledger/20 rounded px-1.5 py-0.5">
                  {r}
                </span>
              ))}
            </div>

            {status === "idle" && (
              <div className="flex gap-2 mt-3.5">
                <button onClick={() => setStatus(job.id, "reviewing")} className={primaryButtonClass}>
                  Apply
                </button>
                <button onClick={() => setStatus(job.id, "skipped")} className={ghostButtonClass}>
                  Skip
                </button>
              </div>
            )}

            {status === "skipped" && (
              <div className="mt-3 text-[12.5px] text-muted/80">
                Skipped.{" "}
                <button onClick={() => clearStatus(job.id)} className={inlineLinkClass}>
                  Undo
                </button>
              </div>
            )}

            {status === "reviewing" && (
              <div className="mt-3.5 pt-3.5 border-t border-line">
                <div className="text-[13.5px] font-semibold text-ink mb-2">Before this goes anywhere</div>
                <ul className="m-0 pl-4.5 text-[13px] text-muted leading-relaxed list-disc">
                  <li>{profile.resume_file_name ? `Resume: ${profile.resume_file_name}` : "No resume uploaded — add one in the Profile tab"}</li>
                  <li>Auto-filled fields: {autoFields.map((f) => f.label).join(", ") || "none set"}</li>
                  <li>You&apos;ll be prompted live for: {manualFields.map((f) => f.label).join(", ") || "nothing — all fields are automatic"}</li>
                </ul>
                <div className="text-xs text-ledger bg-ledger/[0.06] border border-ledger/20 rounded px-2.5 py-1.5 my-2.5 leading-relaxed">
                  Ready to apply — ask Claude, e.g. &ldquo;Apply to {job.title} at {job.company} for me.&rdquo; Claude
                  opens the application via Claude in Chrome, fills what it can from your saved info, and checks with
                  you before submitting anything. This app records the real result (status and activity log) once
                  that session finishes — refresh below to see it.
                </div>
                <div className="flex gap-2">
                  <button onClick={() => refreshApplications()} className={ghostButtonClass}>
                    Refresh status
                  </button>
                  <button onClick={() => clearStatus(job.id)} className={ghostButtonClass}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {(status === "in_progress" || status === "needs_input" || status === "ready_for_review") && (
              <div className="mt-3.5 pt-3.5 border-t border-line">
                <div className="text-[13.5px] text-muted">
                  Apply session in progress ({status.replace(/_/g, " ")})
                  {status === "ready_for_review" ? " — Claude is waiting on your confirmation in that session." : "."}
                </div>
                <button onClick={() => refreshApplications()} className={`${ghostButtonClass} mt-2`}>
                  Refresh status
                </button>
              </div>
            )}

            {status === "failed" && (
              <div className="mt-3.5 pt-3.5 border-t border-line">
                <div className="text-[13.5px] text-muted">This application didn&apos;t go through. Check the activity log or ask Claude what happened.</div>
                <button onClick={() => clearStatus(job.id)} className={`${ghostButtonClass} mt-2`}>
                  Reset
                </button>
              </div>
            )}

            {status === "submitted" && (
              <div className="mt-3">
                <div className="flex items-center gap-1.5 text-[12.5px] text-ledger">
                  <Check size={13} /> Submitted.
                </div>
                {application && (
                  <>
                    <button
                      onClick={() => toggleActivityLog(application.id)}
                      className={`${ghostButtonClass} inline-flex items-center gap-1.5 mt-2`}
                    >
                      {expandedLogApplicationId === application.id ? (
                        <ChevronUp size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )}
                      <ScrollText size={13} /> Activity log
                    </button>
                    {expandedLogApplicationId === application.id && (
                      <div className="mt-2 border border-line rounded px-3 py-2.5 bg-white/60">
                        {loadingApplicationId === application.id && (
                          <div className="font-mono text-[11px] text-muted">Loading…</div>
                        )}
                        {loadingApplicationId !== application.id &&
                          (entriesByApplication[application.id]?.length ?? 0) === 0 && (
                            <div className="font-mono text-[11px] text-muted">No entries yet.</div>
                          )}
                        {loadingApplicationId !== application.id &&
                          entriesByApplication[application.id]?.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px] py-1 border-b border-line/60 last:border-b-0"
                            >
                              <span className="font-mono text-[10.5px] text-muted/80">
                                {new Date(entry.timestamp).toLocaleString()}
                              </span>
                              <span className="text-ink font-medium">{entry.field_label}</span>
                              <span className="font-mono text-[10.5px] text-ledger bg-ledger/[0.08] border border-ledger/20 rounded px-1.5 py-0.5">
                                {entry.value_category}
                              </span>
                              <span className="text-muted">sent to {entry.sent_to}</span>
                              <span className="font-mono text-[10px] uppercase text-muted/80">{entry.source}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </SectionCard>
        );
      })}

      {filtered.length > 0 && (
        <div className="mt-5.5">
          <button onClick={() => setShowFilteredOut((v) => !v)} className={`${ghostButtonClass} inline-flex items-center gap-1.5`}>
            {showFilteredOut ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {filtered.length} postings didn&apos;t match — {showFilteredOut ? "hide" : "show"}
          </button>
          {showFilteredOut && (
            <div className="mt-3">
              {filtered.map(({ job, reasons }) => (
                <div key={job.id} className="px-3.5 py-2.5 border-b border-line opacity-75">
                  <div className="text-[13.5px] text-ink">
                    {job.title} · <span className="text-muted">{job.company}</span>
                  </div>
                  <div className="text-xs text-muted/80 mt-0.5">{reasons.join(" · ")}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
