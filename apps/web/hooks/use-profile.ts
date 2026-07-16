"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Level, Profile } from "@/lib/types";

export type SaveState = "idle" | "saving" | "saved";

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p: Profile) => {
        if (!cancelled) {
          setProfile(p);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((patch: Partial<Pick<Profile, "locations" | "levels" | "target_titles">>) => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const updated: Profile = await res.json();
      setProfile(updated);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1200);
    }, 500);
  }, []);

  const setLocations = useCallback(
    (locations: string[]) => {
      setProfile((prev) => (prev ? { ...prev, locations } : prev));
      persist({ locations });
    },
    [persist]
  );

  const setLevels = useCallback(
    (levels: Level[]) => {
      setProfile((prev) => (prev ? { ...prev, levels } : prev));
      persist({ levels });
    },
    [persist]
  );

  const setTargetTitles = useCallback(
    (target_titles: string[]) => {
      setProfile((prev) => (prev ? { ...prev, target_titles } : prev));
      persist({ target_titles });
    },
    [persist]
  );

  const uploadResume = useCallback(async (file: File) => {
    setSaveState("saving");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/profile/resume", { method: "POST", body: form });
    const updated: Profile = await res.json();
    setProfile(updated);
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 1200);
  }, []);

  const removeResume = useCallback(async () => {
    const res = await fetch("/api/profile/resume", { method: "DELETE" });
    const updated: Profile = await res.json();
    setProfile(updated);
  }, []);

  return { profile, loading, saveState, setLocations, setLevels, setTargetTitles, uploadResume, removeResume };
}
