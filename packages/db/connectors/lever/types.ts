// ---------------------------------------------------------------------------
// Types for the Lever public Postings API.
//
// Shape confirmed against the official docs (github.com/lever/postings-api)
// and a live call to the `leverdemo` site (Lever's own public demo board):
//   GET https://api.lever.co/v0/postings/{site}?mode=json
// This is a public, unauthenticated, read-only endpoint -- no API key
// needed for listing/reading postings (an API key is only required for the
// separate *application-submission* POST endpoint, which this connector
// doesn't use). Intentionally a partial typing -- see normalize.ts for which
// fields are used; `raw_payload` stores the full untouched object.
// ---------------------------------------------------------------------------

export interface LeverCategories {
  location?: string;
  commitment?: string;
  team?: string;
  department?: string;
  allLocations?: string[];
}

export interface LeverSalaryRange {
  currency: string;
  interval: string;
  min: number;
  max: number;
}

export interface LeverPosting {
  id: string;
  text: string;
  categories: LeverCategories;
  /** ISO 3166-1 alpha-2 country code, or null. Not filterable per Lever's docs. */
  country: string | null;
  createdAt: number;
  hostedUrl: string;
  applyUrl: string;
  /** "unspecified" | "on-site" | "remote" | "hybrid" per Lever's docs. */
  workplaceType?: "unspecified" | "on-site" | "remote" | "hybrid";
  salaryRange?: LeverSalaryRange;
  // Description/opening/lists/additional fields exist on the real response
  // but aren't used for normalization here (see README) -- not modeled
  // further. Anything Lever sends rides along in raw_payload untouched.
  [key: string]: unknown;
}
