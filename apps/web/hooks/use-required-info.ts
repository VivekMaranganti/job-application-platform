"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequiredFieldId, RequiredFieldMode, RequiredInfoAnswer } from "@/lib/types";

export function useRequiredInfo() {
  const [answers, setAnswers] = useState<Record<RequiredFieldId, RequiredInfoAnswer> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/required-info")
      .then((r) => r.json())
      .then((list: RequiredInfoAnswer[]) => {
        if (cancelled) return;
        const byField = {} as Record<RequiredFieldId, RequiredInfoAnswer>;
        list.forEach((a) => {
          byField[a.field_id] = a;
        });
        setAnswers(byField);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAnswer = useCallback(
    async (fieldId: RequiredFieldId, patch: Partial<{ mode: RequiredFieldMode; value: string }>) => {
      setAnswers((prev) =>
        prev
          ? {
              ...prev,
              [fieldId]: { ...prev[fieldId], ...patch },
            }
          : prev
      );
      const res = await fetch("/api/required-info", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field_id: fieldId, ...patch }),
      });
      const updated: RequiredInfoAnswer = await res.json();
      setAnswers((prev) => (prev ? { ...prev, [fieldId]: updated } : prev));
    },
    []
  );

  return { answers, loading, updateAnswer };
}
