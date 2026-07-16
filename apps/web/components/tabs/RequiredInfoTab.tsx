"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { useRequiredInfo } from "@/hooks/use-required-info";
import { REQUIRED_FIELDS, type RequiredFieldId } from "@/lib/types";
import { SectionCard, Stamp, ghostButtonClass, inputClass, modeButtonClass, primaryButtonClass } from "@/components/ui/primitives";

interface TitleQuestion {
  question: string;
  options: string[];
}

type TitleStage = "idle" | "loading" | "questions" | "finalizing" | "error" | "done";

export function RequiredInfoTab() {
  const { profile, setTargetTitles } = useProfile();
  const { answers, loading, updateAnswer } = useRequiredInfo();

  const [titleStage, setTitleStage] = useState<TitleStage>("idle");
  const [titleError, setTitleError] = useState("");
  const [resumeSummary, setResumeSummary] = useState("");
  const [questions, setQuestions] = useState<TitleQuestion[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, string>>({});
  const [addedTitles, setAddedTitles] = useState<string[]>([]);

  const startTitleDerivation = async () => {
    setTitleStage("loading");
    setTitleError("");
    setQuestionAnswers({});
    setAddedTitles([]);
    try {
      const res = await fetch("/api/title-suggestions", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResumeSummary(data.resume_summary || "");
      setQuestions(data.questions || []);
      setTitleStage("questions");
    } catch (e) {
      setTitleError(e instanceof Error ? e.message : "We couldn't read that resume automatically. You can try again or add titles manually.");
      setTitleStage("error");
    }
  };

  const submitTitleAnswers = async () => {
    setTitleStage("finalizing");
    try {
      const res = await fetch("/api/title-suggestions/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions, answers: questionAnswers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      const existing = profile?.target_titles ?? [];
      const newTitles: string[] = (data.titles || []).filter((t: string) => !existing.includes(t));
      if (newTitles.length > 0) setTargetTitles([...existing, ...newTitles]);
      setAddedTitles(newTitles);
      setTitleStage("done");
    } catch (e) {
      setTitleError(e instanceof Error ? e.message : "Something went wrong generating your title suggestions. You can try again or add titles manually.");
      setTitleStage("error");
    }
  };

  if (loading || !answers || !profile) {
    return <div className="font-mono text-xs text-muted">Loading required information…</div>;
  }

  const allQuestionsAnswered = questions.length > 0 && questions.every((_, i) => questionAnswers[i]);
  const hasResume = !!profile.resume_file_name;

  return (
    <div>
      <p className="text-[13.5px] text-muted mt-0 mb-4.5 leading-relaxed">
        Applications often include standard EEO and voluntary disclosure questions. For each one, decide whether the
        agent can answer it for you, or whether you&apos;d rather be prompted every time.
      </p>

      <SectionCard>
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <div>
            <div className="font-semibold text-[14.5px] text-ink">Derive job titles from your resume</div>
            <div className="text-[13px] text-muted mt-0.5">A short set of questions to translate your resume into target titles.</div>
          </div>
          {titleStage === "idle" && (
            <button
              onClick={startTitleDerivation}
              disabled={!hasResume}
              className={primaryButtonClass}
            >
              <Sparkles size={14} /> {hasResume ? "Suggest titles" : "Upload a resume first"}
            </button>
          )}
        </div>

        {titleStage === "loading" && (
          <div className="py-5 text-center text-muted">
            <Loader2 size={20} className="animate-spin-slow mx-auto" />
            <div className="mt-2 text-[13.5px]">Reading your resume…</div>
          </div>
        )}

        {titleStage === "questions" && (
          <div className="mt-4 pt-4 border-t border-line">
            {resumeSummary && <p className="text-[13px] text-muted mt-0 mb-4 leading-relaxed">{resumeSummary}</p>}
            {questions.map((q, i) => (
              <div key={i} className="mb-4">
                <div className="text-sm font-semibold text-ink mb-2">{q.question}</div>
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setQuestionAnswers((prev) => ({ ...prev, [i]: opt }))}
                      className={modeButtonClass(questionAnswers[i] === opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={submitTitleAnswers} disabled={!allQuestionsAnswered} className={primaryButtonClass}>
                Get title suggestions
              </button>
              <button onClick={() => setTitleStage("idle")} className={ghostButtonClass}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {titleStage === "finalizing" && (
          <div className="py-5 text-center text-muted">
            <Loader2 size={20} className="animate-spin-slow mx-auto" />
            <div className="mt-2 text-[13.5px]">Putting together your title list…</div>
          </div>
        )}

        {titleStage === "error" && (
          <div className="mt-3.5 pt-3.5 border-t border-line">
            <p className="text-[13.5px] text-bronze m-0">{titleError}</p>
            <button onClick={() => setTitleStage("idle")} className={`${ghostButtonClass} mt-2.5`}>
              Try again
            </button>
          </div>
        )}

        {titleStage === "done" && (
          <div className="mt-3.5 pt-3.5 border-t border-line">
            {addedTitles.length > 0 ? (
              <>
                <div className="text-[13.5px] text-ink mb-2">Added to your Profile tab:</div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {addedTitles.map((t) => (
                    <span key={t} className="text-[13px] bg-paper rounded-full px-3 py-1.5">
                      {t}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[13.5px] text-muted m-0">No new titles to add — your list already covers these.</p>
            )}
            <button onClick={() => setTitleStage("idle")} className={ghostButtonClass}>
              Done
            </button>
          </div>
        )}
      </SectionCard>

      {REQUIRED_FIELDS.map((field) => {
        const answer = answers[field.id] ?? { user_id: "", field_id: field.id, mode: "manual" as const, value: "" };
        return (
          <SectionCard key={field.id}>
            <div className="flex justify-between items-start gap-3">
              <div className="flex-1">
                <div className="font-semibold text-[14.5px] text-ink">{field.label}</div>
                <div className="text-[13px] text-muted mt-0.5">{field.question}</div>
              </div>
              <Stamp mode={answer.mode} />
            </div>

            {field.caution && (
              <div className="text-xs text-bronze bg-bronze/[0.08] border border-bronze/25 rounded px-2.5 py-1.5 mt-2.5">
                {field.caution}
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => updateAnswer(field.id as RequiredFieldId, { mode: "auto" })}
                className={modeButtonClass(answer.mode === "auto")}
              >
                Answer automatically
              </button>
              <button
                onClick={() => updateAnswer(field.id as RequiredFieldId, { mode: "manual" })}
                className={modeButtonClass(answer.mode === "manual")}
              >
                I&apos;ll enter it myself
              </button>
            </div>

            {answer.mode === "auto" && (
              <div className="mt-3">
                {field.type === "yesno" && (
                  <select
                    value={answer.value}
                    onChange={(e) => updateAnswer(field.id as RequiredFieldId, { value: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Select an answer…</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                )}
                {field.type === "select" && (
                  <select
                    value={answer.value}
                    onChange={(e) => updateAnswer(field.id as RequiredFieldId, { value: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Select an answer…</option>
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
                {field.type === "text" && (
                  <input
                    value={answer.value}
                    onChange={(e) => updateAnswer(field.id as RequiredFieldId, { value: e.target.value })}
                    placeholder="Your standard answer"
                    className={inputClass}
                  />
                )}
              </div>
            )}

            {answer.mode === "manual" && (
              <div className="text-[12.5px] text-muted/80 mt-2.5">You&apos;ll be prompted for this answer during each application.</div>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}
