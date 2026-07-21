// ---------------------------------------------------------------------------
// Types for the SmartRecruiters public Posting API (the *Customer API's*
// Posting API, at api.smartrecruiters.com/v1/companies/{id}/postings* --
// NOT the Marketplace "Job Board API" at api.smartrecruiters.com/feed/*,
// which requires a partner `X-SmartToken` and is a different product).
//
// Shape confirmed against the official docs:
//   List:    https://developers.smartrecruiters.com/docs/endpoints
//   Objects: https://developers.smartrecruiters.com/docs/objects
// Both the list endpoint (`GET /v1/companies/{id}/postings`) and the detail
// endpoint (`GET /v1/companies/{id}/postings/{postingId}`) are public and
// unauthenticated per SmartRecruiters' own example requests (plain `curl`,
// no auth header) -- confirmed by reading the docs' example cURL commands,
// not assumed. Intentionally a partial typing -- see normalize.ts for which
// fields are used; `raw_payload` stores the full untouched objects.
//
// Live-endpoint verification was not possible from this environment (see
// README's "Open follow-ups" -- same sandbox network-allowlist limitation
// noted in the Ashby connector).
// ---------------------------------------------------------------------------

export interface SmartRecruitersCompany {
  identifier: string;
  name: string;
}

export interface SmartRecruitersLocation {
  city?: string;
  region?: string;
  country?: string;
  /** Whether this posting is remote. Only distinguishes remote vs. not -- doesn't say Hybrid vs. Onsite for the non-remote case. */
  remote?: boolean;
  latitude?: string;
  longitude?: string;
}

export interface SmartRecruitersIndustry {
  id: string;
  label: string;
}

export interface SmartRecruitersDepartment {
  id: string | number;
  label: string;
  description?: string;
}

export interface SmartRecruitersFunction {
  id: string;
  label: string;
}

/**
 * No fixed enum is documented for either field -- SmartRecruiters' docs
 * describe `id` only as "unique string id" and `label` only as "user
 * friendly label", with no published list of possible values (unlike, say,
 * Ashby's documented employmentType enum). Only `label` is used for
 * normalization (keyword-matched, same treatment as Lever's free-text
 * `commitment` field) since `id` isn't safe to hardcode a mapping against
 * without a canonical list to check it against.
 */
export interface SmartRecruitersTypeOfEmployment {
  id?: string;
  label?: string;
}

export interface SmartRecruitersExperienceLevel {
  id?: string;
  label?: string;
}

/** Returned by the list endpoint (`GET /v1/companies/{id}/postings`). Deliberately missing a public-facing URL field -- see normalize.ts/fetch.ts for why a second request per posting is made. */
export interface SmartRecruitersPosting {
  id: string;
  uuid: string;
  name: string;
  refNumber?: string;
  releasedDate: string;
  company: SmartRecruitersCompany;
  location?: SmartRecruitersLocation;
  industry?: SmartRecruitersIndustry;
  department?: SmartRecruitersDepartment;
  function?: SmartRecruitersFunction;
  typeOfEmployment?: SmartRecruitersTypeOfEmployment;
  experienceLevel?: SmartRecruitersExperienceLevel;
  /** API URL (JSON) for this posting's full detail -- not a human-facing page. See `postingUrl` on SmartRecruitersPostingDetails for that. */
  ref: string;
  [key: string]: unknown;
}

export interface SmartRecruitersListResult {
  limit: number;
  offset: number;
  totalFound: number;
  content: SmartRecruitersPosting[];
}

/** Returned by the detail endpoint (`GET /v1/companies/{id}/postings/{postingId}`). Superset of SmartRecruitersPosting's fields, plus the public URLs the list endpoint omits. */
export interface SmartRecruitersPostingDetails {
  id: string;
  uuid: string;
  name: string;
  company: SmartRecruitersCompany;
  location?: SmartRecruitersLocation;
  industry?: SmartRecruitersIndustry;
  department?: SmartRecruitersDepartment;
  function?: SmartRecruitersFunction;
  typeOfEmployment?: SmartRecruitersTypeOfEmployment;
  experienceLevel?: SmartRecruitersExperienceLevel;
  /** URL to the public job ad page a candidate would view -- used as this connector's `url`. */
  postingUrl?: string;
  /** URL to the (SmartRecruiters-hosted) application form -- not used as `url` here, same "hosted/view page, not the apply-specific page" convention as the Lever connector's use of `hostedUrl` over `applyUrl`. */
  applyUrl?: string;
  active?: boolean;
  [key: string]: unknown;
}
