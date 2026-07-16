"use client";

import { useFilters } from "@/hooks/use-filters";
import {
  COMPANY_SIZES,
  DATE_POSTED_OPTIONS,
  EMPLOYMENT_TYPES,
  WORK_ARRANGEMENTS,
  type CompanySize,
  type EmploymentType,
  type WorkArrangement,
} from "@/lib/types";
import { ChipInput, Label, SectionCard, ToggleGroup, inputClass } from "@/components/ui/primitives";

export function FiltersTab() {
  const { filters, loading, patch } = useFilters();

  if (loading || !filters) {
    return <div className="font-mono text-xs text-muted">Loading filters…</div>;
  }

  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  return (
    <div>
      <p className="text-[13.5px] text-muted mt-0 mb-4.5 leading-relaxed">
        These narrow down which postings the agent surfaces and applies to.
      </p>

      <Label>Work arrangement</Label>
      <SectionCard>
        <ToggleGroup
          options={WORK_ARRANGEMENTS}
          selected={filters.work_arrangement}
          onToggle={(opt: WorkArrangement) => patch({ work_arrangement: toggle(filters.work_arrangement, opt) })}
        />
      </SectionCard>

      <Label>Employment type</Label>
      <SectionCard>
        <ToggleGroup
          options={EMPLOYMENT_TYPES}
          selected={filters.employment_type}
          onToggle={(opt: EmploymentType) => patch({ employment_type: toggle(filters.employment_type, opt) })}
        />
      </SectionCard>

      <Label>Company size</Label>
      <SectionCard>
        <ToggleGroup
          options={COMPANY_SIZES}
          selected={filters.company_size}
          onToggle={(opt: CompanySize) => patch({ company_size: toggle(filters.company_size, opt) })}
        />
      </SectionCard>

      <Label>Minimum salary (optional)</Label>
      <SectionCard>
        <input
          value={filters.salary_min ?? ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "");
            patch({ salary_min: digits ? parseInt(digits, 10) : null });
          }}
          placeholder="e.g. 90000"
          inputMode="numeric"
          className={inputClass}
        />
      </SectionCard>

      <Label>Date posted</Label>
      <SectionCard>
        <ToggleGroup options={DATE_POSTED_OPTIONS} selected={[filters.date_posted]} onToggle={(opt) => patch({ date_posted: opt })} />
      </SectionCard>

      <Label>Industries of interest (optional)</Label>
      <SectionCard>
        <ChipInput items={filters.industries} setItems={(industries) => patch({ industries })} placeholder="e.g. Healthcare — press Enter" />
      </SectionCard>

      <Label>Companies to exclude (optional)</Label>
      <SectionCard>
        <ChipInput
          items={filters.exclude_companies}
          setItems={(exclude_companies) => patch({ exclude_companies })}
          placeholder="e.g. Acme Corp — press Enter"
        />
      </SectionCard>

      <Label>Special instructions</Label>
      <SectionCard>
        <textarea
          value={filters.special_instructions}
          onChange={(e) => patch({ special_instructions: e.target.value })}
          placeholder="Anything else the agent should factor in — e.g. prioritize roles that mention sponsorship, skip anything requiring a cover letter, favor 4-day workweeks…"
          rows={4}
          className={`${inputClass} resize-y leading-relaxed`}
        />
      </SectionCard>
    </div>
  );
}
