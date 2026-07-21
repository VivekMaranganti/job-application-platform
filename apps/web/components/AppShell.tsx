"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProfileTab } from "@/components/tabs/ProfileTab";
import { FiltersTab } from "@/components/tabs/FiltersTab";
import { RequiredInfoTab } from "@/components/tabs/RequiredInfoTab";
import { JobFeedTab } from "@/components/tabs/JobFeedTab";
import { CredentialsTab } from "@/components/tabs/CredentialsTab";

type TabId = "profile" | "filters" | "required" | "jobs" | "accounts";

const TABS: { id: TabId; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "filters", label: "Filters" },
  { id: "required", label: "Required information" },
  { id: "jobs", label: "Job feed" },
  { id: "accounts", label: "Accounts" },
];

export function AppShell({ userEmail }: { userEmail: string }) {
  const [tab, setTab] = useState<TabId>("profile");
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-paper [background-image:radial-gradient(circle_at_1px_1px,rgba(27,30,35,0.035)_1px,transparent_0)] [background-size:22px_22px]">
      <div className="max-w-[720px] mx-auto px-5 py-10 pb-20">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] tracking-widest uppercase text-bronze mb-1.5">
              Case File — Applicant Profile
            </div>
            <h1 className="font-semibold text-[32px] text-ink m-0 tracking-tight">Your application dossier</h1>
            <p className="text-[14.5px] text-muted mt-2 leading-relaxed">
              Everything here stays private to your account. It&apos;s the information the search and apply agent
              will draw on.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 pt-1 shrink-0">
            <span className="font-mono text-[12px] text-muted">{userEmail}</span>
            <button
              onClick={handleLogout}
              className="font-mono text-[12px] text-bronze underline cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="flex gap-1 relative z-10">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`font-mono text-[12.5px] tracking-wide px-4.5 pt-2.5 pb-3 border border-line rounded-t-lg -mb-px cursor-pointer transition-transform ${
                  active ? "bg-white text-ink border-b-white translate-y-0" : "bg-paper text-muted translate-y-[3px]"
                }`}
              >
                {t.label}
              </button>
            );
          })}
          <div className="flex-1 border-b border-line -mb-px" />
        </div>

        <div className="border border-line border-t-0 rounded-b-lg bg-white px-5.5 py-6">
          {tab === "profile" && <ProfileTab onGoToRequiredInfo={() => setTab("required")} />}
          {tab === "filters" && <FiltersTab />}
          {tab === "required" && <RequiredInfoTab />}
          {tab === "jobs" && <JobFeedTab />}
          {tab === "accounts" && <CredentialsTab />}
        </div>
      </div>
    </div>
  );
}
