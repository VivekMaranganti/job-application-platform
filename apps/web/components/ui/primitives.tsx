"use client";

import { useState } from "react";
import { Check, RotateCcw, ShieldCheck, X, Plus } from "lucide-react";

// ---------------------------------------------------------------------------
// Shared UI building blocks, ported from job-application-profile.jsx's
// inline-styled components into Tailwind, keeping the "dossier" visual
// language (paper background, ledger-green primary, bronze "manual" stamp).
// See app/globals.css for the color tokens.
// ---------------------------------------------------------------------------

export function Stamp({ mode }: { mode: "auto" | "manual" }) {
  const isAuto = mode === "auto";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-mono text-[10px] font-medium uppercase tracking-wider px-2 py-1 border -rotate-2 select-none ${
        isAuto ? "border-ledger text-ledger bg-ledger/[0.06]" : "border-bronze text-bronze bg-bronze/[0.08]"
      }`}
    >
      {isAuto ? <ShieldCheck size={11} /> : <RotateCcw size={11} />}
      {isAuto ? "Auto" : "Manual"}
    </span>
  );
}

export function Chip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-white border border-line rounded-full pl-3 pr-1.5 py-1 text-[13.5px] text-ink">
      {text}
      <button
        onClick={onRemove}
        aria-label={`Remove ${text}`}
        className="border-none bg-paper rounded-full w-[18px] h-[18px] flex items-center justify-center cursor-pointer text-muted hover:text-ink"
      >
        <X size={11} />
      </button>
    </span>
  );
}

export function ChipInput({
  items,
  setItems,
  placeholder,
}: {
  items: string[];
  setItems: (items: string[]) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState("");
  const addItem = () => {
    const v = value.trim();
    if (v && !items.includes(v)) setItems([...items, v]);
    setValue("");
  };
  return (
    <div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2.5">
          {items.map((it) => (
            <Chip key={it} text={it} onRemove={() => setItems(items.filter((x) => x !== it))} />
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder={placeholder}
          className={inputClass}
        />
        <button onClick={addItem} aria-label="Add" className={smallAddButtonClass}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

export function ToggleGroup<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: T[];
  selected: T[];
  onToggle: (opt: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13.5px] border cursor-pointer ${
              active ? "border-ledger bg-ledger text-paper" : "border-line bg-white text-ink"
            }`}
          >
            {active && <Check size={13} />}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="bg-white border border-line rounded-lg px-5 py-4.5 mb-3.5">{children}</div>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block font-mono text-[11px] tracking-wider uppercase text-muted mb-2">{children}</label>
  );
}

export const inputClass =
  "flex-1 px-3 py-2.5 text-sm border border-line rounded-md bg-white text-ink outline-none focus:border-ledger";

export const smallAddButtonClass =
  "border border-ledger bg-ledger text-paper rounded-md w-[38px] flex items-center justify-center cursor-pointer hover:opacity-90";

export const ghostButtonClass =
  "text-[12.5px] px-3 py-1.5 rounded-md border border-line bg-white text-muted cursor-pointer whitespace-nowrap hover:bg-paper";

export const primaryButtonClass =
  "text-[13px] font-semibold px-3.5 py-2 rounded-md border border-ledger bg-ledger text-paper inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed";

export const inlineLinkClass = "border-none bg-transparent text-ledger underline cursor-pointer text-[12.5px] p-0";

export function modeButtonClass(active: boolean) {
  return `text-[12.5px] px-3 py-1.5 rounded-md border cursor-pointer ${
    active ? "border-ledger bg-ledger text-paper" : "border-line bg-white text-muted"
  }`;
}
