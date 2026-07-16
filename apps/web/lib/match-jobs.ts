import type { DatePosted, Filters, JobListing, Level } from "@/lib/types";

// ---------------------------------------------------------------------------
// Ported from job-application-profile.jsx's matchJobs, adapted to the real
// JobListing/Filters/Profile shapes (snake_case fields, nullable connector
// data) instead of the prototype's mock objects. Behavior/reasoning
// transparency is preserved: every listing gets an explicit list of reasons
// it matched or didn't.
// ---------------------------------------------------------------------------

export interface MatchInput {
  locations: string[];
  levels: Level[];
  titles: string[];
  filters: Pick<
    Filters,
    | "work_arrangement"
    | "employment_type"
    | "company_size"
    | "salary_min"
    | "date_posted"
    | "industries"
    | "exclude_companies"
  >;
}

export interface MatchResult {
  matched: { job: JobListing; reasons: string[] }[];
  filtered: { job: JobListing; reasons: string[] }[];
}

function datePostedCutoff(option: DatePosted): Date | null {
  const now = new Date();
  if (option === "Past 24 hours") return new Date(now.getTime() - 1 * 86400000);
  if (option === "Past week") return new Date(now.getTime() - 7 * 86400000);
  if (option === "Past month") return new Date(now.getTime() - 30 * 86400000);
  return null;
}

export function matchJobs(jobs: JobListing[], input: MatchInput): MatchResult {
  const { locations, levels, titles, filters } = input;
  const cutoff = datePostedCutoff(filters.date_posted);
  const locLower = locations.map((l) => l.toLowerCase());
  const wantsRemote = locLower.some((l) => l.includes("remote") || l.includes("anywhere"));
  const titleLower = titles.map((t) => t.toLowerCase());

  const matched: MatchResult["matched"] = [];
  const filtered: MatchResult["filtered"] = [];

  jobs.forEach((job) => {
    const reasonsFor: string[] = [];
    const reasonsAgainst: string[] = [];

    // Location
    if (locations.length === 0) {
      reasonsFor.push("No location filter set");
    } else if (job.location == null) {
      reasonsAgainst.push("Location not listed for this posting");
    } else {
      const locMatch =
        locLower.some((l) => job.location!.toLowerCase().includes(l)) ||
        (wantsRemote && job.remote_type === "Remote");
      if (locMatch) reasonsFor.push(`Location: ${job.location}`);
      else reasonsAgainst.push(`Location (${job.location}) doesn't match your list`);
    }

    // Level
    if (levels.length === 0) {
      // no constraint
    } else if (job.level == null) {
      reasonsAgainst.push("Level not listed for this posting");
    } else if (levels.includes(job.level)) {
      reasonsFor.push(`Level: ${job.level}`);
    } else {
      reasonsAgainst.push(`Level (${job.level}) not in your selected levels`);
    }

    // Titles / keywords
    if (titleLower.length === 0) {
      // no constraint
    } else {
      const titleMatch = titleLower.some((t) => job.title.toLowerCase().includes(t));
      if (titleMatch) reasonsFor.push("Matches a target title");
      else reasonsAgainst.push("Title doesn't match your target titles");
    }

    // Work arrangement
    if (filters.work_arrangement.length > 0) {
      if (job.remote_type != null && filters.work_arrangement.includes(job.remote_type)) {
        reasonsFor.push(`Work style: ${job.remote_type}`);
      } else {
        reasonsAgainst.push(`Work style (${job.remote_type ?? "not listed"}) not selected`);
      }
    }

    // Employment type
    if (filters.employment_type.length > 0) {
      if (job.employment_type != null && filters.employment_type.includes(job.employment_type)) {
        reasonsFor.push(`Type: ${job.employment_type}`);
      } else {
        reasonsAgainst.push(`Employment type (${job.employment_type ?? "not listed"}) not selected`);
      }
    }

    // Company size
    if (filters.company_size.length > 0) {
      if (job.company_size != null && filters.company_size.includes(job.company_size)) {
        reasonsFor.push(`Company size: ${job.company_size}`);
      } else {
        reasonsAgainst.push("Company size not selected");
      }
    }

    // Salary
    if (filters.salary_min) {
      const min = filters.salary_min;
      if (job.salary_max == null) {
        reasonsAgainst.push("Salary not listed");
      } else if (job.salary_max >= min) {
        reasonsFor.push(`Salary up to $${job.salary_max.toLocaleString()}`);
      } else {
        reasonsAgainst.push(`Salary below your $${min.toLocaleString()} minimum`);
      }
    }

    // Date posted
    if (cutoff) {
      if (job.date_posted == null) {
        reasonsAgainst.push("Date posted not listed");
      } else if (new Date(job.date_posted) >= cutoff) {
        reasonsFor.push("Recently posted");
      } else {
        reasonsAgainst.push("Posted before your date range");
      }
    }

    // Industries
    if (filters.industries.length > 0) {
      if (job.industry != null && filters.industries.includes(job.industry)) {
        reasonsFor.push(`Industry: ${job.industry}`);
      } else {
        reasonsAgainst.push(`Industry (${job.industry ?? "not listed"}) not selected`);
      }
    }

    // Excluded companies
    if (filters.exclude_companies.some((c) => c.toLowerCase() === job.company.toLowerCase())) {
      reasonsAgainst.push("Company is on your exclude list");
    }

    if (reasonsAgainst.length === 0) {
      matched.push({ job, reasons: reasonsFor });
    } else {
      filtered.push({ job, reasons: reasonsAgainst });
    }
  });

  return { matched, filtered };
}
