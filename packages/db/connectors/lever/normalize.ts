import type { Prisma } from "@prisma/client";
import type { SiteConfig } from "./config.ts";
import type { LeverPosting } from "./types.ts";
import { inferEmploymentTypeFromTitle, inferLevelFromTitle, type InferredEmploymentType } from "../shared/title-inference.ts";

// ---------------------------------------------------------------------------
// Raw Lever posting -> JobListing shape. Same field-name-matches-schema
// convention as connectors/greenhouse/normalize.ts (see that file's header
// for the full rationale) -- camelCase fields here map 1:1 to
// prisma/schema.prisma's JobListing model, and the literal strings used
// match apps/web/lib/types.ts's unions exactly. packages/db still doesn't
// import apps/web types directly, for the same reason as the Greenhouse
// connector.
//
// Lever's API gives more structured signal than Greenhouse's for a few
// fields that Greenhouse could only leave null -- see the per-field notes
// below.
// ---------------------------------------------------------------------------

export const SOURCE_CONNECTOR = "Lever";

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

/**
 * Lever's `workplaceType` is a direct, structured field ("unspecified" |
 * "on-site" | "remote" | "hybrid") -- unlike Greenhouse, which has no such
 * field and requires inferring remote/hybrid from free-text location
 * strings. "unspecified" (Lever's own "we don't know" value) maps to null
 * rather than to "Onsite", consistent with this project's "leave null
 * rather than guess" rule.
 */
function mapWorkplaceType(workplaceType: LeverPosting["workplaceType"]): NormalizedJobListing["remoteType"] {
  switch (workplaceType) {
    case "remote":
      return "Remote";
    case "hybrid":
      return "Hybrid";
    case "on-site":
      return "Onsite";
    default:
      return null;
  }
}

/**
 * `categories.commitment` is a structured field on the posting (e.g. "Full-time",
 * "Part Time", "Intern", "Contract" -- exact strings vary per Lever account,
 * since it's a free-text field the employer configures, not a fixed enum).
 * A keyword match against it is still a real signal, not a guess -- unlike
 * inferring employment type from a title's *absence* of a marker, this is
 * reading an explicit field the employer set for this exact purpose. Falls
 * back to title-keyword inference (which never assumes Full-time) if
 * commitment is missing or doesn't match any keyword.
 */
function inferEmploymentTypeFromCommitment(
  commitment: string | undefined,
  title: string
): InferredEmploymentType | null {
  if (commitment) {
    const c = commitment.toLowerCase();
    if (/intern/.test(c)) return "Internship";
    if (/contract/.test(c)) return "Contract";
    if (/part[ -]?time/.test(c)) return "Part-time";
    if (/full[ -]?time/.test(c)) return "Full-time";
  }
  return inferEmploymentTypeFromTitle(title);
}

function parseDatePosted(posting: LeverPosting): Date | null {
  if (typeof posting.createdAt !== "number") return null;
  const parsed = new Date(posting.createdAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeLeverPosting(posting: LeverPosting, site: SiteConfig): NormalizedJobListing {
  return {
    sourceConnector: SOURCE_CONNECTOR,
    externalId: posting.id,
    title: posting.text,
    // Lever's postings API has no company-display-name field (unlike
    // Greenhouse's company_name) -- falls back to the raw site slug if no
    // override is configured.
    company: site.companyName ?? site.site,
    location: posting.categories?.location ?? null,
    remoteType: mapWorkplaceType(posting.workplaceType),
    employmentType: inferEmploymentTypeFromCommitment(posting.categories?.commitment, posting.text),
    level: inferLevelFromTitle(posting.text),
    // Lever's salaryRange is a real structured field (unlike Greenhouse,
    // which has none) -- used directly when present, left null otherwise
    // (salaryRange is optional per Lever's own docs).
    salaryMin: posting.salaryRange?.min ?? null,
    salaryMax: posting.salaryRange?.max ?? null,
    // Not inferable from the API -- operator-supplied static fact (config.ts).
    companySize: site.companySize ?? null,
    industry: site.industry ?? null,
    datePosted: parseDatePosted(posting),
    url: posting.hostedUrl,
    // Lever's response is plain JSON at runtime; the cast is only needed
    // because LeverPosting's TS shape doesn't structurally match Prisma's
    // stricter InputJsonValue type.
    rawPayload: posting as unknown as Prisma.InputJsonValue,
  };
}
