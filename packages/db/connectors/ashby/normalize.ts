import type { Prisma } from "@prisma/client";
import type { JobBoardConfig } from "./config.ts";
import type { AshbyJob } from "./types.ts";
import { inferEmploymentTypeFromTitle, inferLevelFromTitle } from "../shared/title-inference.ts";

// ---------------------------------------------------------------------------
// Raw Ashby posting -> JobListing shape. Same field-name-matches-schema
// convention as connectors/lever/normalize.ts (see that file's header, and
// connectors/greenhouse/normalize.ts before it, for the full rationale) --
// camelCase fields here map 1:1 to prisma/schema.prisma's JobListing model,
// and the literal strings used match apps/web/lib/types.ts's unions
// exactly.
//
// Ashby, like Lever, exposes more structured signal than Greenhouse for a
// few fields -- see the per-field notes below.
// ---------------------------------------------------------------------------

export const SOURCE_CONNECTOR = "Ashby";

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
 * Ashby's `workplaceType` is a direct, structured field ("OnSite" | "Remote"
 * | "Hybrid") -- unlike Greenhouse, which has no such field. Missing/other
 * values map to null rather than "Onsite", consistent with this project's
 * "leave null rather than guess" rule (same treatment as Lever's
 * "unspecified").
 */
function mapWorkplaceType(workplaceType: AshbyJob["workplaceType"]): NormalizedJobListing["remoteType"] {
  switch (workplaceType) {
    case "Remote":
      return "Remote";
    case "Hybrid":
      return "Hybrid";
    case "OnSite":
      return "Onsite";
    default:
      return null;
  }
}

/**
 * Ashby's `employmentType` is a direct, structured field (not free text the
 * employer configures, unlike Lever's `categories.commitment`) -- so it's an
 * even stronger signal than Lever's when present. "Temporary" has no
 * corresponding value in this schema's employment-type union (which only
 * has Full-time/Part-time/Contract/Internship) -- forcing it into "Contract"
 * would misrepresent it, so it's deliberately left null (falls through to
 * title-keyword inference instead, same as an unset field).
 */
function mapEmploymentType(
  employmentType: AshbyJob["employmentType"],
  title: string
): NormalizedJobListing["employmentType"] {
  switch (employmentType) {
    case "FullTime":
      return "Full-time";
    case "PartTime":
      return "Part-time";
    case "Intern":
      return "Internship";
    case "Contract":
      return "Contract";
    case "Temporary":
      return inferEmploymentTypeFromTitle(title);
    default:
      return inferEmploymentTypeFromTitle(title);
  }
}

/**
 * Extracts a salary range from Ashby's compensation payload (only present
 * when `includeCompensation=true` was requested -- see fetch.ts, which
 * always requests it). Looks for a "Salary" component in
 * `compensation.summaryComponents`; returns nulls if compensation data is
 * absent or has no salary component (e.g. equity-only or unlisted-comp
 * postings).
 */
function extractSalaryRange(job: AshbyJob): { min: number | null; max: number | null } {
  const salaryComponent = job.compensation?.summaryComponents?.find(
    (c) => c.compensationType === "Salary"
  );
  return {
    min: salaryComponent?.minValue ?? null,
    max: salaryComponent?.maxValue ?? null,
  };
}

function parseDatePosted(job: AshbyJob): Date | null {
  if (typeof job.publishedAt !== "string") return null;
  const parsed = new Date(job.publishedAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeAshbyJob(job: AshbyJob, board: JobBoardConfig): NormalizedJobListing {
  const { min: salaryMin, max: salaryMax } = extractSalaryRange(job);
  return {
    sourceConnector: SOURCE_CONNECTOR,
    // Ashby's public Job Postings API has no dedicated posting-id field in
    // its documented response (confirmed against the official
    // field-reference table, not just the example) -- `jobUrl` is the most
    // stable unique-per-posting value it does return, so it doubles as the
    // idempotency key here. See README's "Open follow-ups".
    externalId: job.jobUrl,
    title: job.title,
    // Ashby's postings API has no company-display-name field either (same
    // situation as Lever) -- falls back to the raw job board name if no
    // override is configured.
    company: board.companyName ?? board.jobBoardName,
    location: job.location ?? null,
    remoteType: mapWorkplaceType(job.workplaceType),
    employmentType: mapEmploymentType(job.employmentType, job.title),
    // Ashby's API has no level/seniority field -- same title-only inference
    // as Greenhouse/Lever, and the same reasons a bare title is left null.
    level: inferLevelFromTitle(job.title),
    salaryMin,
    salaryMax,
    // Not inferable from the API -- operator-supplied static fact (config.ts).
    companySize: board.companySize ?? null,
    industry: board.industry ?? null,
    datePosted: parseDatePosted(job),
    url: job.jobUrl,
    // Ashby's response is plain JSON at runtime; the cast is only needed
    // because AshbyJob's TS shape doesn't structurally match Prisma's
    // stricter InputJsonValue type.
    rawPayload: job as unknown as Prisma.InputJsonValue,
  };
}
