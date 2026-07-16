import type { DatePosted, Filters, JobListing, Level } from "@/lib/types";

// ---------------------------------------------------------------------------
// Ported from job-application-profile.jsx's matchJobs, adapted to the real
// JobListing/Filters/Profile shapes (snake_case fields, nullable connector
// data) instead of the prototype's mock objects. Behavior/reasoning
// transparency is preserved: every listing gets an explicit list of reasons
// it matched or didn't.
//
// HANDLING FIELDS A CONNECTOR LEFT NULL: the prototype's mock data had
// every field populated, so it never had to decide how to treat a field a
// connector couldn't determine. Real ATS connectors leave a lot of fields
// null on purpose rather than guess (see e.g.
// connectors/greenhouse/README.md -- most real Greenhouse/Lever postings
// have no explicit employment_type, remote_type, level, industry, or
// salary at all). Originally this module treated null the same as an
// explicit mismatch, which meant in practice almost no real
// connector-sourced listing could ever match once a user set even one
// employment_type/work_arrangement/level/industry/salary filter, since
// that data is absent on most real postings -- silently making those
// filters equivalent to "hide everything."
//
// Fixed by treating null as neutral for every one of those fields: "this
// posting doesn't say, so this filter doesn't apply to it" (a reasonFor,
// not a reasonAgainst), never a confirmed non-match. A stricter
// alternative was tried for work_arrangement/employment_type specifically
// -- defaulting null to "Onsite"/"Full-time" (the statistically likely
// real value when a connector leaves it unlabeled), so it'd satisfy those
// filters but not Remote/Hybrid/Internship/Contract/Part-time ones -- but
// was deliberately reverted: this product prioritizes not hiding a posting
// the connector simply couldn't classify over the precision of excluding
// probably-mismatched postings from a narrow filter. The tradeoff you're
// accepting with neutral-on-null: a Remote-only or Internship-only filter
// will also surface unlabeled postings that are probably ordinary
// onsite/full-time roles, since nothing rules them out.
//
// level, industry, company_size, and salary never had a real-world default
// to lean on in the first place (there's no "most jobs are Mid-level"
// assumption), so the same neutral treatment applies to them for the same
// reason it applies to work_arrangement/employment_type now.
//
// location and date_posted are left strict (null still disqualifies)
// since connectors do reliably populate them and a user's location/
// recency preference is central enough to matching quality that silently
// ignoring it would be worse.
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

    // Level. Same "unknown isn't a mismatch" rule as work arrangement/
    // employment type below -- title-keyword level inference
    // (connectors/shared/title-inference.ts) only fires on a clear keyword
    // ("Senior", "Director", "Staff"...); a bare title like "Product
    // Manager" is genuinely ambiguous and left null on purpose, not a
    // signal the posting is at some other level.
    if (levels.length === 0) {
      // no constraint
    } else if (job.level == null) {
      reasonsFor.push("Level not listed for this posting (filter not applied)");
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

    // Work arrangement. Null remote_type is treated as neutral -- "this
    // posting doesn't say, so this filter doesn't apply to it" -- not as an
    // implicit Onsite. (A stricter version of this defaulted null to
    // Onsite, on the reasoning that connectors only leave this null for a
    // bare office location with no hybrid/remote marker, so it
    // overwhelmingly means onsite in practice -- deliberately reverted:
    // this product favors not hiding a posting the connector simply
    // couldn't classify over the precision of excluding a probably-onsite
    // role from a Remote/Hybrid filter. See git history if you want that
    // stricter behavior back.)
    if (filters.work_arrangement.length > 0) {
      if (job.remote_type == null) {
        reasonsFor.push("Work style not listed by this posting (filter not applied)");
      } else if (filters.work_arrangement.includes(job.remote_type)) {
        reasonsFor.push(`Work style: ${job.remote_type}`);
      } else {
        reasonsAgainst.push(`Work style (${job.remote_type}) not selected`);
      }
    }

    // Employment type. Same neutral-on-null treatment as work arrangement
    // above, same deliberate tradeoff: an Internship/Contract/Part-time-only
    // filter will also surface unlabeled postings that are probably
    // ordinary full-time roles, in exchange for never hiding a posting the
    // connector just didn't tag.
    if (filters.employment_type.length > 0) {
      if (job.employment_type == null) {
        reasonsFor.push("Employment type not listed by this posting (filter not applied)");
      } else if (filters.employment_type.includes(job.employment_type)) {
        reasonsFor.push(`Type: ${job.employment_type}`);
      } else {
        reasonsAgainst.push(`Employment type (${job.employment_type}) not selected`);
      }
    }

    // Company size. Same "unknown isn't a mismatch" rule -- company_size is
    // only ever set when the connector's operator supplied it statically
    // (per-board config), so it's null for most real listings, not a signal
    // the employer actively omitted.
    if (filters.company_size.length > 0) {
      if (job.company_size == null) {
        reasonsFor.push("Company size not listed (filter not applied)");
      } else if (filters.company_size.includes(job.company_size)) {
        reasonsFor.push(`Company size: ${job.company_size}`);
      } else {
        reasonsAgainst.push(`Company size (${job.company_size}) not selected`);
      }
    }

    // Salary. Same "unknown isn't a mismatch" rule -- most connectors
    // (Greenhouse entirely, Lever on many postings) have no structured
    // compensation data at all, which is an API gap, not evidence the pay
    // is below your minimum.
    if (filters.salary_min) {
      const min = filters.salary_min;
      if (job.salary_max == null) {
        reasonsFor.push("Salary not listed (filter not applied)");
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

    // Industries. Same "unknown isn't a mismatch" rule -- industry is only
    // ever set when a connector's operator supplied it statically, so it's
    // null for most listings by default, not an employer omission.
    if (filters.industries.length > 0) {
      if (job.industry == null) {
        reasonsFor.push("Industry not listed (filter not applied)");
      } else if (filters.industries.includes(job.industry)) {
        reasonsFor.push(`Industry: ${job.industry}`);
      } else {
        reasonsAgainst.push(`Industry (${job.industry}) not selected`);
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
