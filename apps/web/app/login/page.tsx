"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Minimal magic-link login/signup form (issue #3). There is no separate
// "sign up" page: submitting an email that hasn't been seen before creates
// the account (see lib/auth.ts requestLogin) -- proportionate for an
// early-stage, single-user-per-account app.
//
// No real email integration exists in this repo yet (see AUTH.md), so in
// dev mode the response includes the link directly and this page renders it
// as a clickable "Continue" link instead of making the developer dig it out
// of server console output.
// ---------------------------------------------------------------------------
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [devLoginUrl, setDevLoginUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage(null);
    setDevLoginUrl(null);

    try {
      const res = await fetch("/api/auth/request-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStatus("sent");
      setMessage(data.message);
      if (data.devLoginUrl) setDevLoginUrl(data.devLoginUrl);
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-5">
      <div className="w-full max-w-[380px] border border-line rounded-lg bg-white px-6 py-8">
        <div className="font-mono text-[11px] tracking-widest uppercase text-bronze mb-1.5">
          Case File — Sign In
        </div>
        <h1 className="font-semibold text-[22px] text-ink m-0 tracking-tight mb-2">Sign in to your dossier</h1>
        <p className="text-[13.5px] text-muted mb-5 leading-relaxed">
          Enter your email and we&apos;ll send a one-time link to sign in. No password needed.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="border border-line rounded-md px-3 py-2 text-[14px] text-ink"
            disabled={status === "sending"}
          />
          <button
            type="submit"
            disabled={status === "sending" || !email}
            className="bg-ink text-white rounded-md px-3 py-2 text-[14px] font-medium disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Send login link"}
          </button>
        </form>

        {message && (
          <p className={`text-[13px] mt-4 leading-relaxed ${status === "error" ? "text-red-600" : "text-muted"}`}>
            {message}
          </p>
        )}

        {devLoginUrl && (
          <a
            href={devLoginUrl}
            className="block mt-3 text-[13px] font-mono text-bronze underline break-all"
          >
            Continue (dev mode — no email was sent)
          </a>
        )}
      </div>
    </div>
  );
}
