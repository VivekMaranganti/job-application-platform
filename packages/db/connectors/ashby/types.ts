// ---------------------------------------------------------------------------
// Types for the Ashby public Job Postings API.
//
// Shape confirmed against the official docs
// (https://developers.ashbyhq.com/docs/public-job-posting-api):
//   GET https://api.ashbyhq.com/posting-api/job-board/{jobBoardName}?includeCompensation=true
// This is a public, unauthenticated, read-only endpoint -- no API key
// needed. Note: Ashby's own docs page has a malformed JSON *example*
// response (missing commas, and shows "compensation" as a sibling of
// "jobs" rather than nested under each job) -- the field-reference *table*
// on that same page is unambiguous that `compensation` is a per-job field
// (`jobs[].compensation`), so the table was trusted over the broken
// example when they disagreed. Intentionally a partial typing -- see
// normalize.ts for which fields are used; `raw_payload` stores the full
// untouched job object.
//
// Live-endpoint verification against a real Ashby job board was not
// possible from this environment (outbound network to api.ashbyhq.com is
// blocked by this sandbox's proxy allowlist -- the same limitation noted
// for Prisma's binaries.prisma.sh calls elsewhere in this project, not a
// code issue) -- see README's "Open follow-ups".
// ---------------------------------------------------------------------------

export interface AshbySecondaryLocationAddress {
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
}

export interface AshbySecondaryLocation {
  location?: string;
  address?: AshbySecondaryLocationAddress;
}

export interface AshbyPostalAddress {
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
}

export interface AshbyCompensationComponent {
  id?: string;
  summary?: string;
  compensationType: string;
  interval: string;
  currencyCode: string | null;
  minValue: number | null;
  maxValue: number | null;
}

export interface AshbyCompensation {
  compensationTierSummary?: string;
  scrapeableCompensationSalarySummary?: string;
  compensationTiers?: unknown[];
  summaryComponents?: AshbyCompensationComponent[];
  [key: string]: unknown;
}

export interface AshbyJob {
  title: string;
  location: string;
  secondaryLocations?: AshbySecondaryLocation[];
  department?: string;
  team?: string;
  isListed: boolean;
  isRemote: boolean;
  /** "OnSite" | "Remote" | "Hybrid" per Ashby's docs -- omitted/other values left unmapped. */
  workplaceType?: "OnSite" | "Remote" | "Hybrid";
  descriptionHtml?: string;
  descriptionPlain?: string;
  /** ISO datetime string. */
  publishedAt: string;
  /** "FullTime" | "PartTime" | "Intern" | "Contract" | "Temporary" per Ashby's docs. */
  employmentType?: "FullTime" | "PartTime" | "Intern" | "Contract" | "Temporary";
  address?: {
    postalAddress?: AshbyPostalAddress;
  };
  /** Public-facing Ashby-hosted page for this posting. Also doubles as this connector's `external_id` -- see normalize.ts for why (Ashby's public API has no dedicated posting-id field). */
  jobUrl: string;
  applyUrl: string;
  /** Included only when `includeCompensation=true` is passed (this connector always passes it -- see fetch.ts). */
  compensation?: AshbyCompensation;
  // descriptionHtml/descriptionPlain/team/department/secondaryLocations ride
  // along in raw_payload untouched but aren't used for normalization.
  [key: string]: unknown;
}

export interface AshbyJobBoardResponse {
  apiVersion: string;
  jobs: AshbyJob[];
}
