// ---------------------------------------------------------------------------
// Types for the Greenhouse public Job Board API.
//
// Shape confirmed by hitting the real, public, unauthenticated endpoints
// (no API key needed) during development:
//   GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
//   GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{id}
// against several real boards (gitlab, asana, squarespace, elastic). This is
// intentionally a partial/best-effort typing of the response -- Greenhouse's
// schema varies slightly per board (custom `metadata` questions, optional
// `education`/`data_compliance` blocks, etc.) and we don't need most of it
// for normalization. `raw_payload` stores the full untouched object
// regardless of what's typed here.
// ---------------------------------------------------------------------------

export interface GreenhouseLocation {
  name: string;
}

export interface GreenhouseJob {
  id: number;
  internal_job_id?: number;
  title: string;
  updated_at: string;
  /** When the requisition was first posted. Absent on some older boards. */
  first_published?: string | null;
  location: GreenhouseLocation;
  absolute_url: string;
  /** The company display name. Present on every board we inspected, but not documented as guaranteed. */
  company_name?: string;
  /** Full job description as HTML, only present when the request included `content=true`. */
  content?: string;
  requisition_id?: string | null;
  // Deliberately not modeled further (departments/offices/metadata/etc.) --
  // see normalize.ts for which fields we do and don't try to derive
  // classifier data from, and why. Anything else Greenhouse sends rides
  // along in raw_payload untouched.
  [key: string]: unknown;
}

export interface GreenhouseJobsResponse {
  jobs: GreenhouseJob[];
  meta: { total: number };
}
