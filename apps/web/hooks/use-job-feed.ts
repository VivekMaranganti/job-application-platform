"use client";

import { useCallback, useEffect, useState } from "react";
import type { Application, ApplicationStatus, JobListing } from "@/lib/types";

export function useJobFeed() {
  const [jobs, setJobs] = useState<JobListing[] | null>(null);
  const [applications, setApplications] = useState<Record<string, Application>>({});
  const [loading, setLoading] = useState(true);

  const loadApplications = useCallback(async () => {
    const res = await fetch("/api/applications");
    const list: Application[] = await res.json();
    const byJob: Record<string, Application> = {};
    list.forEach((a) => {
      byJob[a.job_listing_id] = a;
    });
    setApplications(byJob);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [jobsRes] = await Promise.all([fetch("/api/jobs"), loadApplications()]);
      const jobList: JobListing[] = await jobsRes.json();
      if (!cancelled) {
        setJobs(jobList);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadApplications]);

  const setStatus = useCallback(async (jobListingId: string, status: ApplicationStatus) => {
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_listing_id: jobListingId, status }),
    });
    const application: Application = await res.json();
    setApplications((prev) => ({ ...prev, [jobListingId]: application }));
    return application;
  }, []);

  const clearStatus = useCallback(async (jobListingId: string) => {
    await fetch(`/api/applications?job_listing_id=${encodeURIComponent(jobListingId)}`, { method: "DELETE" });
    setApplications((prev) => {
      const next = { ...prev };
      delete next[jobListingId];
      return next;
    });
  }, []);

  // TODO(issue #4 — Apply agent): this calls the simulate-submit stub, not a
  // real apply agent. See app/api/applications/[jobListingId]/simulate-submit/route.ts.
  const simulateSubmit = useCallback(async (jobListingId: string) => {
    const res = await fetch(`/api/applications/${encodeURIComponent(jobListingId)}/simulate-submit`, {
      method: "POST",
    });
    const data: { application: Application; note: string } = await res.json();
    setApplications((prev) => ({ ...prev, [jobListingId]: data.application }));
    return data;
  }, []);

  return { jobs, applications, loading, setStatus, clearStatus, simulateSubmit };
}
