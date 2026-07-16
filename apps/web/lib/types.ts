// ---------------------------------------------------------------------------
// Shared data model types.
//
// These mirror the project's data model spec (see issue #1 / issue #2) using
// the same field names and enum values so that the repository layer can be
// rewired to the real Postgres schema (issue #2) without changing call sites
// or renaming fields throughout the app.
// ---------------------------------------------------------------------------

export type Level =
  | "Entry level"
  | "Mid level"
  | "Senior"
  | "Staff / Principal"
  | "Manager"
  | "Director"
  | "Executive / VP";

export const LEVELS: Level[] = [
  "Entry level",
  "Mid level",
  "Senior",
  "Staff / Principal",
  "Manager",
  "Director",
  "Executive / VP",
];

export type WorkArrangement = "Remote" | "Hybrid" | "Onsite";
export const WORK_ARRANGEMENTS: WorkArrangement[] = ["Remote", "Hybrid", "Onsite"];

export type EmploymentType = "Full-time" | "Part-time" | "Contract" | "Internship";
export const EMPLOYMENT_TYPES: EmploymentType[] = ["Full-time", "Part-time", "Contract", "Internship"];

export type CompanySize =
  | "Startup (1-50)"
  | "Small-mid (51-500)"
  | "Large (501-5,000)"
  | "Enterprise (5,000+)";

export const COMPANY_SIZES: CompanySize[] = [
  "Startup (1-50)",
  "Small-mid (51-500)",
  "Large (501-5,000)",
  "Enterprise (5,000+)",
];

export type DatePosted = "Any time" | "Past 24 hours" | "Past week" | "Past month";
export const DATE_POSTED_OPTIONS: DatePosted[] = ["Any time", "Past 24 hours", "Past week", "Past month"];

export type RequiredFieldMode = "auto" | "manual";

export type RequiredFieldId =
  | "work_auth"
  | "sponsorship"
  | "veteran"
  | "disability"
  | "race_ethnicity"
  | "gender"
  | "security_clearance"
  | "criminal_history";

export interface RequiredFieldDef {
  id: RequiredFieldId;
  label: string;
  question: string;
  type: "yesno" | "select" | "text";
  options?: string[];
  caution?: string;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export interface Profile {
  user_id: string;
  resume_file_url: string | null;
  resume_uploaded_at: string | null;
  /**
   * Not in the original data-model spec, but needed to render the uploaded
   * file's name/size in the UI without re-fetching/parsing the file itself.
   * Judgment call — see final report. Safe to drop or rename at merge time.
   */
  resume_file_name: string | null;
  resume_file_size: number | null;
  locations: string[];
  levels: Level[];
  target_titles: string[];
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
export interface Filters {
  user_id: string;
  work_arrangement: WorkArrangement[];
  employment_type: EmploymentType[];
  company_size: CompanySize[];
  salary_min: number | null;
  date_posted: DatePosted;
  industries: string[];
  exclude_companies: string[];
  special_instructions: string;
}

// ---------------------------------------------------------------------------
// Required information answers
// ---------------------------------------------------------------------------
export interface RequiredInfoAnswer {
  user_id: string;
  field_id: RequiredFieldId;
  mode: RequiredFieldMode;
  value: string;
}

// ---------------------------------------------------------------------------
// Job listings (as returned by ATS connectors — mocked for now)
// ---------------------------------------------------------------------------
export interface JobListing {
  id: string;
  source_connector: string;
  external_id: string;
  title: string;
  company: string;
  // Classifier fields below are nullable: connector data is heterogeneous
  // and not guaranteed to match our closed vocabularies at ingestion time
  // (mirrors packages/db's schema, where these are free-text/nullable
  // rather than enums for the same reason).
  location: string | null;
  remote_type: WorkArrangement | null;
  employment_type: EmploymentType | null;
  level: Level | null;
  salary_min: number | null;
  salary_max: number | null;
  company_size: CompanySize | null;
  industry: string | null;
  date_posted: string | null; // ISO timestamp
  url: string;
  raw_payload: unknown;
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------
export type ApplicationStatus =
  | "matched"
  | "reviewing"
  | "in_progress"
  | "needs_input"
  | "ready_for_review"
  | "submitted"
  | "skipped"
  | "failed";

export interface Application {
  id: string;
  user_id: string;
  job_listing_id: string;
  status: ApplicationStatus;
  created_at: string;
  submitted_at: string | null;
}

// ---------------------------------------------------------------------------
// Activity log (issue #6)
//
// Audit trail of what was submitted on a user's behalf during form-filling.
// Mirrors packages/db's ApplicationLogEntry model exactly on purpose:
// `value_category` is a coarse label (e.g. "work_auth", "resume") — NEVER
// the raw value that was typed/selected/uploaded. There is intentionally no
// field here that could hold a raw answer; callers must not repurpose
// `value_category` (or any other field) to carry one. See
// packages/db/prisma/schema.prisma's ApplicationLogEntry doc comment and
// packages/db/README.md "Encryption at rest" for the full rationale.
// ---------------------------------------------------------------------------
export type LogEntrySource = "auto" | "user-provided-live";

export interface ApplicationLogEntry {
  id: string;
  application_id: string;
  user_id: string;
  timestamp: string;
  field_label: string;
  value_category: string;
  sent_to: string;
  source: LogEntrySource;
}

// ---------------------------------------------------------------------------
// Standard EEO / voluntary-disclosure fields (shared, not per-user)
// ---------------------------------------------------------------------------
const RACE_OPTIONS = [
  "American Indian or Alaska Native",
  "Asian",
  "Black or African American",
  "Hispanic or Latino",
  "Native Hawaiian or Other Pacific Islander",
  "White",
  "Two or more races",
  "Prefer not to answer",
];

export const REQUIRED_FIELDS: RequiredFieldDef[] = [
  {
    id: "work_auth",
    label: "Work authorization",
    question: "Are you legally authorized to work in the country where this position is located?",
    type: "yesno",
  },
  {
    id: "sponsorship",
    label: "Visa sponsorship",
    question: "Will you now or in the future require sponsorship for employment visa status?",
    type: "yesno",
  },
  {
    id: "veteran",
    label: "Veteran status",
    question: "Please indicate your veteran status.",
    type: "select",
    options: ["Not a protected veteran", "Identify as a protected veteran", "Prefer not to answer"],
  },
  {
    id: "disability",
    label: "Disability status",
    question: "Please indicate your disability status.",
    type: "select",
    options: ["Yes, I have a disability", "No, I do not have a disability", "Prefer not to answer"],
  },
  {
    id: "race_ethnicity",
    label: "Race / ethnicity",
    question: "Voluntary self-identification of race or ethnicity.",
    type: "select",
    options: RACE_OPTIONS,
  },
  {
    id: "gender",
    label: "Gender identity",
    question: "Voluntary self-identification of gender.",
    type: "select",
    options: ["Male", "Female", "Non-binary", "Prefer not to answer"],
  },
  {
    id: "security_clearance",
    label: "Security clearance",
    question: "Do you currently hold a government security clearance?",
    type: "select",
    options: ["None", "Active clearance", "Inactive clearance", "Eligible for clearance"],
  },
  {
    id: "criminal_history",
    label: "Criminal history",
    question:
      "Some applications ask about criminal history. Rules on what may be asked, and when, vary by state and city.",
    type: "text",
    caution:
      "Because the legality of this question depends on where the job is located, we recommend answering it yourself on each application.",
  },
];
