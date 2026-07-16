"use client";

import { useCallback, useState } from "react";
import type { ApplicationLogEntry } from "@/lib/types";

/**
 * Lazily loads the Activity Log for one Application (issue #6), on demand
 * (e.g. when a user expands the "View activity log" disclosure in the Job
 * Feed tab) rather than eagerly for every application in the list.
 */
export function useActivityLog() {
  const [entriesByApplication, setEntriesByApplication] = useState<Record<string, ApplicationLogEntry[]>>({});
  const [loadingApplicationId, setLoadingApplicationId] = useState<string | null>(null);

  const loadEntries = useCallback(async (applicationId: string) => {
    setLoadingApplicationId(applicationId);
    try {
      const res = await fetch(`/api/activity-log?application_id=${encodeURIComponent(applicationId)}`);
      const entries: ApplicationLogEntry[] = await res.json();
      setEntriesByApplication((prev) => ({ ...prev, [applicationId]: entries }));
    } finally {
      setLoadingApplicationId(null);
    }
  }, []);

  return { entriesByApplication, loadingApplicationId, loadEntries };
}
