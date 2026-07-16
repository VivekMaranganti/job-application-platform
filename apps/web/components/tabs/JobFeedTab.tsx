"use client";

import { useMemo, useState } from "react";
import { Building2, Check, ChevronDown, ChevronUp, Clock, DollarSign, MapPin } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { useFilters } from "@/hooks/use-filters";
import { useJobFeed } from "@/hooks/use-job-feed";
import { matchJobs } from "@/lib/match-jobs";
import { REQUIRED_FIELDS, type Application } from "@/lib/types";
import { useRequiredInfo } from "@/hooks/use-required-info";
import { SectionCard, ghostButtonClass, inlineLinkClass, primaryButtonClass } from "@/components/ui/primitives";

const metaClass = "inline-flex items-center gap-1 text-[12.5px] text-muted";

export function JobFeedTab() {
  const { profile, loading: profileLoading } = useProfile();
  const { filters, loading: filtersLoading } = useFilters();
  const { answers } = useRequiredInfo();
  const { jobs, applications, loading: jobsLoading, setStatus, clearStatus, simulateSubmit } = useJobFeed();
  const [showFilteredOut, setShowFilteredOut] = useState(false);
  const [simulateNote, setSimulateNote] = useState<Record<string, string>>({});

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

  const confirmApply = async (jobId: string, company: string) => {
    const data = await simulateSubmit(jobId);
    setSimulateNote((prev) => ({ ...prev, [jobId]: data.note }));
    void company;
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
                <div className="text-xs text-bronze bg-bronze/[0.08] border border-bronze/25 rounded px-2.5 py-1.5 my-2.5">
                  The live apply agent isn&apos;t connected yet (issue #4), so confirming here just records what would
                  have been sent — nothing is actually submitted to {job.company}.
                </div>
                <div className="flex gap-2">
                  <button onClick={() => confirmApply(job.id, job.company)} className={primaryButtonClass}>
                    Confirm (simulated)
                  </button>
                  <button onClick={() => clearStatus(job.id)} className={ghostButtonClass}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {status === "submitted" && (
              <div className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ledger">
                <Check size={13} /> {simulateNote[job.id] ?? "Recorded (simulated)."} Real activity logging is tracked
                separately (issue #6).
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
