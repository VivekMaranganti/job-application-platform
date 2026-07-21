import type { SmartRecruitersListResult, SmartRecruitersPosting, SmartRecruitersPostingDetails } from "./types.ts";

// ---------------------------------------------------------------------------
// SmartRecruiters' Customer API Posting API (`/v1/companies/{id}/postings*`)
// is public and unauthenticated for reads -- confirmed from the official
// docs' own example requests, which are plain `curl` calls with no auth
// header (https://developers.smartrecruiters.com/docs/endpoints). This is a
// different product from the Marketplace "Job Board API"
// (`/feed/publications`), which the docs explicitly say requires a partner
// `X-SmartToken` -- this connector never calls that endpoint.
//
// A live call could not be made from this development environment (see
// connectors/smartrecruiters/README.md's "Open follow-ups" -- same sandbox
// network-allowlist limitation noted in the Ashby connector).
// ---------------------------------------------------------------------------

const SMARTRECRUITERS_API_BASE = "https://api.smartrecruiters.com/v1/companies";
const PAGE_SIZE = 100;

/**
 * Fetches every active posting for a company, paging through
 * `offset`/`limit` until `totalFound` is exhausted. Unlike Greenhouse/Lever
 * (where a single generous page was used because no documented cap on
 * result size exists), SmartRecruiters' docs explicitly describe
 * offset/limit pagination with a real `totalFound` count -- so pagination
 * is implemented here rather than assuming everything fits on one page.
 */
export async function fetchSmartRecruitersPostings(companyIdentifier: string): Promise<SmartRecruitersPosting[]> {
  const all: SmartRecruitersPosting[] = [];
  let offset = 0;

  while (true) {
    const url = `${SMARTRECRUITERS_API_BASE}/${encodeURIComponent(companyIdentifier)}/postings?limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `SmartRecruiters API request failed for company "${companyIdentifier}" (offset ${offset}): ${res.status} ${res.statusText}`
      );
    }
    const page = (await res.json()) as SmartRecruitersListResult;
    all.push(...page.content);

    offset += page.content.length;
    if (page.content.length === 0 || offset >= page.totalFound) break;
  }

  return all;
}

/**
 * Fetches full detail for a single posting. The list endpoint
 * (`fetchSmartRecruitersPostings`) doesn't return a public-facing job page
 * URL at all -- only `ref`, an *API* URL for this same detail call, not a
 * human-facing page (confirmed against the docs' field-reference table, not
 * assumed) -- so this second call per posting is the only way to get a real
 * `postingUrl` to store as `JobListing.url`, which the schema requires to
 * be a real, non-null string. See README's "Open follow-ups" for the
 * N-plus-1 cost this incurs on large boards.
 */
export async function fetchSmartRecruitersPostingDetails(
  companyIdentifier: string,
  postingId: string
): Promise<SmartRecruitersPostingDetails> {
  const url = `${SMARTRECRUITERS_API_BASE}/${encodeURIComponent(companyIdentifier)}/postings/${encodeURIComponent(postingId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `SmartRecruiters API request failed for posting "${postingId}" (company "${companyIdentifier}"): ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as SmartRecruitersPostingDetails;
}
