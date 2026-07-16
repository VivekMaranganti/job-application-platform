import type { LeverPosting } from "./types.ts";

// ---------------------------------------------------------------------------
// Lever's Postings API is public and unauthenticated for reads -- no API
// key needed to list/get postings (only the separate application-submission
// POST endpoint requires one, which this connector never calls). Verified
// against the official docs and a live call to the `leverdemo` site during
// development.
// ---------------------------------------------------------------------------

const LEVER_API_BASE = "https://api.lever.co/v0/postings";

/**
 * Fetches every published posting currently on a Lever site. Lever's list
 * endpoint supports `skip`/`limit` pagination, but (per the official docs)
 * doesn't document a hard cap on `limit` -- a generously large single-page
 * limit is requested here rather than building pagination for a case that
 * hasn't been observed to matter yet (same "don't build ahead of the actual
 * need" call as connectors/greenhouse/README.md's pagination follow-up).
 */
export async function fetchLeverSitePostings(site: string): Promise<LeverPosting[]> {
  const url = `${LEVER_API_BASE}/${encodeURIComponent(site)}?mode=json&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Lever API request failed for site "${site}": ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as LeverPosting[];
}
