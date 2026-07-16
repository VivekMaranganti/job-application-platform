import type { GreenhouseJobsResponse } from "./types.ts";

// ---------------------------------------------------------------------------
// Greenhouse's Job Board API is public and unauthenticated -- no API key,
// no auth header, just a GET request per board token. Verified against
// several real boards during development (e.g.
// https://boards-api.greenhouse.io/v1/boards/gitlab/jobs).
// ---------------------------------------------------------------------------

const GREENHOUSE_API_BASE = "https://boards-api.greenhouse.io/v1/boards";

/**
 * Fetches every job currently posted on a Greenhouse job board.
 *
 * `content=true` includes the full HTML job description in each job object.
 * Normalization (normalize.ts) doesn't parse it today -- see that file for
 * why salary/company-size aren't scraped from free text -- but it's cheap to
 * request and worth keeping in `raw_payload` for a future re-normalization
 * pass that might want it.
 */
export async function fetchGreenhouseBoardJobs(boardToken: string): Promise<GreenhouseJobsResponse> {
  const url = `${GREENHOUSE_API_BASE}/${encodeURIComponent(boardToken)}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Greenhouse API request failed for board "${boardToken}": ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GreenhouseJobsResponse;
}
