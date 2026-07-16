"use client";

import { useRef } from "react";
import { FileText, Upload } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { LEVELS } from "@/lib/types";
import { ChipInput, Label, SectionCard, ToggleGroup, ghostButtonClass, inlineLinkClass, inputClass } from "@/components/ui/primitives";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function ProfileTab({ onGoToRequiredInfo }: { onGoToRequiredInfo: () => void }) {
  const { profile, loading, setLocations, setLevels, setTargetTitles, setContactField, uploadResume, removeResume } =
    useProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (loading || !profile) {
    return <div className="font-mono text-xs text-muted">Loading profile…</div>;
  }

  const toggleLevel = (level: (typeof LEVELS)[number]) => {
    setLevels(profile.levels.includes(level) ? profile.levels.filter((l) => l !== level) : [...profile.levels, level]);
  };

  return (
    <div>
      <Label>Contact information</Label>
      <SectionCard>
        <div className="grid grid-cols-2 gap-3">
          <input
            className={inputClass}
            placeholder="Full name"
            defaultValue={profile.full_name ?? ""}
            onBlur={(e) => setContactField("full_name", e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Phone"
            type="tel"
            defaultValue={profile.phone ?? ""}
            onBlur={(e) => setContactField("phone", e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Contact email (defaults to your login email)"
            type="email"
            defaultValue={profile.contact_email ?? ""}
            onBlur={(e) => setContactField("contact_email", e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="LinkedIn URL"
            type="url"
            defaultValue={profile.linkedin_url ?? ""}
            onBlur={(e) => setContactField("linkedin_url", e.target.value)}
          />
          <input
            className={`${inputClass} col-span-2`}
            placeholder="Portfolio / website URL"
            type="url"
            defaultValue={profile.portfolio_url ?? ""}
            onBlur={(e) => setContactField("portfolio_url", e.target.value)}
          />
        </div>
        <div className="mt-3 text-[12.5px] text-muted">
          Used to auto-fill name/contact fields when the apply agent fills out an application.
        </div>
      </SectionCard>

      <Label>Resume</Label>
      <SectionCard>
        {!profile.resume_file_name ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) uploadResume(file);
            }}
            className="border-[1.5px] border-dashed border-line/80 rounded-md px-4 py-7 text-center cursor-pointer text-muted"
          >
            <Upload size={20} className="mx-auto mb-2" />
            <div className="text-sm">Click to upload, or drag your resume here</div>
            <div className="text-xs text-muted/80 mt-1">PDF or Word document</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadResume(file);
              }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-[38px] h-[38px] rounded-md bg-paper flex items-center justify-center text-ledger shrink-0">
              <FileText size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink truncate">{profile.resume_file_name}</div>
              <div className="font-mono text-[11px] text-muted/80">
                {formatBytes(profile.resume_file_size)}
                {profile.resume_uploaded_at ? ` · uploaded ${new Date(profile.resume_uploaded_at).toLocaleDateString()}` : ""}
              </div>
            </div>
            <button onClick={() => fileInputRef.current?.click()} className={ghostButtonClass}>
              Replace
            </button>
            <button onClick={removeResume} className={ghostButtonClass}>
              Remove
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadResume(file);
              }}
            />
          </div>
        )}
      </SectionCard>

      <Label>Locations you&apos;ll work in</Label>
      <SectionCard>
        <ChipInput items={profile.locations} setItems={setLocations} placeholder="e.g. Austin, TX or Remote — press Enter" />
      </SectionCard>

      <Label>Position level</Label>
      <SectionCard>
        <ToggleGroup options={LEVELS} selected={profile.levels} onToggle={toggleLevel} />
      </SectionCard>

      <Label>Target titles or keywords</Label>
      <SectionCard>
        <ChipInput items={profile.target_titles} setItems={setTargetTitles} placeholder="e.g. Product Manager — press Enter" />
        <div className="mt-3 text-[12.5px] text-muted">
          Prefer to derive these from your resume? Head to the{" "}
          <button onClick={onGoToRequiredInfo} className={inlineLinkClass}>
            Required information
          </button>{" "}
          tab.
        </div>
      </SectionCard>
    </div>
  );
}
