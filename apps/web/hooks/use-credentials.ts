"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Credential {
  id: string;
  domain: string;
  siteName: string;
  originHostname: string;
  username: string;
  createdByAgent: boolean;
  createdAt: string;
  lastRevealedAt: string | null;
}

/**
 * How long a revealed password stays on screen before it's wiped from
 * component state. Short enough that walking away doesn't leave a password
 * on the monitor; long enough to read a 24-character string or hit Copy.
 */
const AUTO_HIDE_MS = 30_000;

export function useCredentials() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlockedUntil, setUnlockedUntil] = useState<Date | null>(null);
  /**
   * Revealed passwords, keyed by credential id.
   *
   * Held in component state and nowhere else -- no localStorage, no
   * sessionStorage, no module-level cache. A reveal survives exactly as long
   * as this component is mounted and the timer below hasn't fired, so a page
   * refresh costs another audited round-trip rather than silently re-showing
   * a password from disk.
   */
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const hideTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refresh = useCallback(async () => {
    const res = await fetch("/api/credentials");
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = (await res.json()) as {
      credentials: Credential[];
      unlocked_until: string | null;
    };
    setCredentials(data.credentials);
    setUnlockedUntil(data.unlocked_until ? new Date(data.unlocked_until) : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Clear every pending hide timer on unmount, so a navigation away doesn't
  // leave timers firing setState on a dead component.
  useEffect(() => {
    const timers = hideTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const hide = useCallback((id: string) => {
    const timer = hideTimers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete hideTimers.current[id];
    }
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /** Requests a fresh code. Returns the dev-mode code when one is provided. */
  const requestUnlockCode = useCallback(async (): Promise<{
    message: string;
    devCode?: string;
  }> => {
    const res = await fetch("/api/credentials/unlock", { method: "POST" });
    return (await res.json()) as { message: string; devCode?: string };
  }, []);

  const redeemUnlockCode = useCallback(
    async (code: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch("/api/credentials/unlock?redeem=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as { unlocked_until?: string; error?: string };
      if (!res.ok) return { ok: false, error: data.error };
      if (data.unlocked_until) setUnlockedUntil(new Date(data.unlocked_until));
      return { ok: true };
    },
    [],
  );

  const reveal = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch(`/api/credentials/${id}/reveal`, { method: "POST" });
      const data = (await res.json()) as { password?: string; error?: string };
      if (!res.ok || !data.password) {
        // A 403 here means the window lapsed between render and click.
        if (res.status === 403) setUnlockedUntil(null);
        return { ok: false, error: data.error };
      }

      setRevealed((prev) => ({ ...prev, [id]: data.password! }));
      if (hideTimers.current[id]) clearTimeout(hideTimers.current[id]);
      hideTimers.current[id] = setTimeout(() => hide(id), AUTO_HIDE_MS);
      void refresh();
      return { ok: true };
    },
    [hide, refresh],
  );

  const save = useCallback(
    async (input: {
      url: string;
      username: string;
      password?: string;
    }): Promise<{ ok: boolean; password?: string; error?: string }> => {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, created_by_agent: false }),
      });
      const data = (await res.json()) as { password?: string; error?: string };
      if (!res.ok) return { ok: false, error: data.error };
      await refresh();
      return { ok: true, password: data.password };
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/credentials/${id}`, { method: "DELETE" });
      hide(id);
      await refresh();
    },
    [hide, refresh],
  );

  return {
    credentials,
    loading,
    unlockedUntil,
    revealed,
    requestUnlockCode,
    redeemUnlockCode,
    reveal,
    hide,
    save,
    remove,
    refresh,
    AUTO_HIDE_MS,
  };
}
