import type { Prisma } from "@prisma/client";
import type { BoardConfig } from "./config.ts";
import type { GreenhouseJob } from "./types.ts";
import { inferEmploymentTypeFromTitle, inferLevelFromTitle } from "../shared/title-inference.ts";

// ---------------------------------------------------------------------------
// Raw Greenhouse job -> JobListing shape.
//
// Field names below (camelCase) match prisma/schema.prisma's JobListing
// model 1:1, so a NormalizedJobListing can be passed straight to
// `prisma.jobListing.upsert({ create: ..., update: ... })` (see run.ts).
//
// The literal string values used for remoteType/employmentType/level below
// (e.g. "Hybrid", "Full-time", "Staff / Principal") are deliberately chosen
// to match apps/web/lib/types.ts's WorkArrangement/EmploymentType/Level
// unions and apps/web/lib/repository/seed-jobs.ts's fixture data *exactly*,
// so the existing UI filters (which compare against those literals) work
// unmodified against real Greenhouse-sourced rows. This connector does NOT
// import those types from apps/web, though: packages/db is a standalone
// package that apps/web depends on, not the reverse (see
// packages/db/README.md's opening paragraph), and JobListing's classifier
// columns are free-text/nullable in the schema for exactly this reason
// (prisma/schema.prisma JobListing doc comment) -- what follows is just the
// connector's choice of which strings to write into those free-text
// columns, not a DB- or type-enforced contract with the app.
//
// Guiding principle throughout: infer a field only when a Greenhouse signal
// confidently implies it; otherwise leave it null rather than guess. See
// connectors/greenhouse/README.md for the full rationale per field.
// ---------------------------------------------------------------------------

export const SOURCE_CONNECTOR = "Greenhouse";

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
 * A Greenhouse `location.name` can be a single office ("Austin, TX"), a
 * remote designation ("Remote", "Remote, Italy"), or a semicolon-joined list
 * of several of either ("Remote, Austria; Remote, Germany"). We only call a
 * listing "Remote" when *every* segment says so, and "Hybrid" when any
 * segment says so explicitly -- Greenhouse has no separate hybrid/onsite
 * distinction in the API, so a bare office location ("Austin, TX") is left
 * null rather than assumed to be "Onsite": it could just as easily be
 * hybrid, and the task calls for leaving fields null over guessing.
 */
function inferRemoteType(locationName: string | null): NormalizedJobListing["remoteType"] {
  if (!locationName) return null;
  const segments = locationName
    .split(";")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((s) => s.includes("hybrid"))) return "Hybrid";
  if (segments.every((s) => s.startsWith("remote"))) return "Remote";
  return null;
}

// Level/employment-type inference from title moved to
// ../shared/title-inference.ts once the Lever connector needed the
// identical logic -- see that file for the "infer only when confident"
// rationale, unchanged from what lived here originally.

function parseDatePosted(job: GreenhouseJob): Date | null {
  const raw = job.first_published ?? job.updated_at;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeGreenhouseJob(job: GreenhouseJob, board: BoardConfig): NormalizedJobListing {
  const locationName = job.location?.name ?? null;
  return {
    sourceConnector: SOURCE_CONNECTOR,
    externalId: String(job.id),
    title: job.title,
    company: board.companyName ?? job.company_name ?? board.boardToken,
    location: locationName,
    remoteType: inferRemoteType(locationName),
    employmentType: inferEmploymentTypeFromTitle(job.title),
    level: inferLevelFromTitle(job.title),
    // Greenhouse's public Job Board API has no structured compensation
    // field on any board inspected during development (gitlab, asana,
    // squarespace, elastic all lack one). Some postings do show a pay range
    // as prose inside `content`, but scraping/parsing that reliably is out
    // of scope for this pass -- see connectors/greenhouse/README.md's open
    // follow-ups.
    salaryMin: null,
    salaryMax: null,
    // Not inferable from the API at all -- an operator-supplied static fact
    // about the company (config.ts), not a per-job guess.
    companySize: board.companySize ?? null,
    industry: board.industry ?? null,
    datePosted: parseDatePosted(job),
    url: job.absolute_url,
    // Greenhouse's response is plain JSON at runtime; the cast is only
    // needed because `GreenhouseJob`'s TS shape (optional properties, an
    // index signature) doesn't structurally match Prisma's stricter
    // `InputJsonValue` type.
    rawPayload: job as unknown as Prisma.InputJsonValue,
  };
}
