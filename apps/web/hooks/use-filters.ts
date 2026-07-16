"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Filters } from "@/lib/types";
import type { SaveState } from "./use-profile";

export function useFilters() {
  const [filters, setFilters] = useState<Filters | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/filters")
      .then((r) => r.json())
      .then((f: Filters) => {
        if (!cancelled) {
          setFilters(f);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback((partial: Partial<Omit<Filters, "user_id">>) => {
    setFilters((prev) => (prev ? { ...prev, ...partial } : prev));
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch("/api/filters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const updated: Filters = await res.json();
      setFilters(updated);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1200);
    }, 500);
  }, []);

  return { filters, loading, saveState, patch };
}
