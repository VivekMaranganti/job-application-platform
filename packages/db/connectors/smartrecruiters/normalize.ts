import type { Prisma } from "@prisma/client";
import type { CompanyConfig } from "./config.ts";
import type { SmartRecruitersPosting, SmartRecruitersPostingDetails } from "./types.ts";
import { inferEmploymentTypeFromTitle, inferLevelFromTitle, type InferredLevel } from "../shared/title-inference.ts";

// ---------------------------------------------------------------------------
// Raw SmartRecruiters posting -> JobListing shape. Same field-name-matches-
// schema convention as connectors/ashby/normalize.ts and
// connectors/lever/normalize.ts (see those files' headers for the full
// rationale) -- camelCase fields here map 1:1 to prisma/schema.prisma's
// JobListing model, and the literal strings used match
// apps/web/lib/types.ts's unions exactly.
//
// SmartRecruiters' list endpoint and detail endpoint each have data the
// other doesn't (see fetch.ts) -- this connector calls both per posting and
// normalizes from the combination.
// ---------------------------------------------------------------------------

export const SOURCE_CONNECTOR = "SmartRecruiters";

export interface NormalizedJobListing {
  sourceConnector: string;
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: "Remote" | "Hybrid" | "Onsite" | null;
  employmentType: "Full-time" | "Part-time" | "Contract" | "Internship" | null;
  level:
    | "Entry level"
    | "Mid level"
    | "Senior"
    | "Staff / Principal"
    | "Manager"
    | "Director"
    | "Executive / VP"
    | null;
  salaryMin: number | null;
  salaryMax: number | null;
  companySize: string | null;
  industry: string | null;
  datePosted: Date | null;
  url: string;
  rawPayload: Prisma.InputJsonValue;
}

/** Joins the non-empty parts of a SmartRecruiters location into a single display string, e.g. "San Francisco, CA, us". SmartRecruiters splits location into separate city/region/country fields (unlike Greenhouse/Lever/Ashby's single free-text string) -- there's no field to use verbatim, so this connector builds one, joining only the parts actually present rather than guessing at missing ones. */
function formatLocation(location: SmartRecruitersPosting["location"]): string | null {
  if (!location) return null;
  const parts = [location.city, location.region, location.country].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * SmartRecruiters' `location.remote` is a real per-posting boolean, but it
 * only distinguishes remote vs. not-remote -- unlike Ashby/Lever's
 * three-way workplaceType enum, there's no way to tell Hybrid from Onsite
 * from this field alone. `remote: true` maps to "Remote" (real signal);
 * anything else (`false`, or the field missing) maps to null rather than
 * an assumed "Onsite", consistent with this project's "leave null rather
 * than guess" rule.
 */
function mapRemoteType(remote: boolean | undefined): NormalizedJobListing["remoteType"] {
  return remote === true ? "Remote" : null;
}

/**
 * `typeOfEmployment.label` is a real field the employer sets, but (per
 * SmartRecruiters' own docs) has no published fixed enum of possible
 * values -- same situation as Lever's free-text `categories.commitment`,
 * so it gets the same keyword-match-first, title-fallback-second
 * treatment as `inferEmploymentTypeFromCommitment` in the Lever connector.
 * "Permanent" (SmartRecruiters' own example label for ongoing employment)
 * maps to "Full-time" -- a real signal from an explicit field the employer
 * set for this purpose, not a guess.
 */
function inferEmploymentTypeFromLabel(
  label: string | undefined,
  title: string
): NormalizedJobListing["employmentType"] {
  if (label) {
    const l = label.toLowerCase();
    if (/intern/.test(l)) return "Internship";
    if (/contract/.test(l)) return "Contract";
    if (/part[ -]?time/.test(l)) return "Part-time";
    if (/full[ -]?time/.test(l)) return "Full-time";
    if (/permanent/.test(l)) return "Full-time";
  }
  return inferEmploymentTypeFromTitle(title);
}

/**
 * `experienceLevel.label` has no published fixed enum either (same
 * situation as typeOfEmployment). Unlike employment type, though, several
 * of the labels observed in SmartRecruiters' own docs are ambiguous
 * spanning categories -- e.g. "Mid-Senior Level" isn't cleanly "Mid level"
 * or "Senior". Only keywords unambiguous on their own are matched directly
 * here (Entry/Internship, Director, Executive-or-C-level); anything else
 * -- including "Mid-Senior Level" and "Associate" -- falls through to null
 * (and from there to title-keyword inference), rather than picking one
 * side of an ambiguous label.
 */
function inferLevelFromExperienceLabel(label: string | undefined): InferredLevel | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (/entry|intern/.test(l)) return "Entry level";
  if (/director/.test(l)) return "Director";
  if (/executive|\bvp\b|vice president|c-level|chief/.test(l)) return "Executive / VP";
  return null;
}

function parseDatePosted(releasedDate: string | undefined): Date | null {
  if (typeof releasedDate !== "string") return null;
  const parsed = new Date(releasedDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeSmartRecruitersPosting(
  posting: SmartRecruitersPosting,
  details: SmartRecruitersPostingDetails,
  company: CompanyConfig,
  url: string
): NormalizedJobListing {
  return {
    sourceConnector: SOURCE_CONNECTOR,
    externalId: posting.id,
    title: posting.name,
    // Unlike Lever/Ashby, SmartRecruiters' API does return a real
    // company-display-name field on every posting -- preferred over the
    // config override, which is only a fallback for the rare case it's
    // missing.
    company: posting.company?.name ?? company.companyName ?? company.companyIdentifier,
    location: formatLocation(posting.location),
    remoteType: mapRemoteType(posting.location?.remote),
    employmentType: inferEmploymentTypeFromLabel(posting.typeOfEmployment?.label, posting.name),
    level: inferLevelFromExperienceLabel(posting.experienceLevel?.label) ?? inferLevelFromTitle(posting.name),
    // No compensation field exists anywhere in this API's public responses
    // (list or detail) -- unlike Lever/Ashby, which both have a real
    // structured salary field. Always null, not an inference gap.
    salaryMin: null,
    salaryMax: null,
    // Unlike Lever/Ashby, SmartRecruiters does return a real industry.label
    // on most postings -- preferred over the config override, which is
    // only a fallback for postings that don't have one.
    industry: posting.industry?.label ?? company.industry ?? null,
    // Not inferable from the API at all -- operator-supplied static fact
    // (config.ts), same as every other connector.
    companySize: company.companySize ?? null,
    datePosted: parseDatePosted(posting.releasedDate),
    url,
    // Both the list-item and the detail response are stored together --
    // each has real data the other lacks (see fetch.ts/README), and
    // storing only one would silently drop information a future pass might
    // want.
    rawPayload: { posting, details } as unknown as Prisma.InputJsonValue,
  };
}
