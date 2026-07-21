import type { AshbyJobBoardResponse } from "./types.ts";

// ---------------------------------------------------------------------------
// Ashby's Job Postings API is public and unauthenticated -- no API key
// needed. Verified against the official docs
// (https://developers.ashbyhq.com/docs/public-job-posting-api); a live call
// could not be made from this development environment (outbound network to
// api.ashbyhq.com is blocked by this sandbox's proxy allowlist), so the
// response shape is trusted from the docs' field-reference table rather
// than an observed real response -- see connectors/ashby/README.md.
// ---------------------------------------------------------------------------

const ASHBY_API_BASE = "https://api.ashbyhq.com/posting-api/job-board";

/**
 * Fetches every currently published job posting on an Ashby job board.
 * `includeCompensation=true` is always passed -- compensation is a real,
 * structured signal when present (see normalize.ts), and Ashby's docs say
 * it's simply omitted from each job when not configured, so there's no
 * downside to always requesting it. Ashby's docs don't describe pagination
 * for this endpoint (the whole board's jobs come back in one response), so
 * none is implemented here.
 */
export async function fetchAshbyJobBoardPostings(jobBoardName: string): Promise<AshbyJobBoardResponse> {
  const url = `${ASHBY_API_BASE}/${encodeURIComponent(jobBoardName)}?includeCompensation=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Ashby API request failed for job board "${jobBoardName}": ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as AshbyJobBoardResponse;
}
