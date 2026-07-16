import type {
  Application,
  ApplicationLogEntry,
  ApplicationStatus,
  Filters,
  JobListing,
  LogEntrySource,
  Profile,
  RequiredInfoAnswer,
  RequiredFieldId,
  RequiredFieldMode,
} from "@/lib/types";

/**
 * Everything the app needs to persist, behind one interface.
 *
 * This is the single seam meant to be rewired at merge time: today
 * `lib/repository/index.ts` wires this up to the in-memory stub
 * (`memory.ts`); once `packages/db` (issue #2) lands, a `postgres.ts`
 * implementation backed by its Prisma client + shared encryption helper
 * replaces it there, and nothing outside `lib/repository` should need to
 * change.
 *
 * All methods take `userId` explicitly (see lib/current-user.ts) so
 * multi-tenancy plumbing exists even though auth (issue #3) isn't decided.
 *
 * Methods return/accept *decrypted* plaintext domain objects — see
 * encryption.ts. Sensitive fields (Profile.resume_file_url,
 * RequiredInfoAnswer.value) are encrypted at rest by the implementation;
 * callers above this layer never see ciphertext.
 */
export interface Repository {
  // --- Profile ---------------------------------------------------------
  getProfile(userId: string): Promise<Profile>;
  saveProfile(
    userId: string,
    patch: Partial<Pick<Profile, "locations" | "levels" | "target_titles">>
  ): Promise<Profile>;
  saveResume(
    userId: string,
    file: { fileName: string; fileSize: number; buffer: Buffer; mimeType: string }
  ): Promise<Profile>;
  removeResume(userId: string): Promise<Profile>;
  /** Retrieves the raw resume bytes for server-side use (e.g. AI title derivation). Not exposed directly to the client. */
  getResumeFile(
    userId: string
  ): Promise<{ fileName: string; mimeType: string; buffer: Buffer } | null>;

  // --- Filters -----------------------------------------------------------
  getFilters(userId: string): Promise<Filters>;
  saveFilters(userId: string, patch: Partial<Omit<Filters, "user_id">>): Promise<Filters>;

  // --- Required information ----------------------------------------------
  getRequiredInfoAnswers(userId: string): Promise<RequiredInfoAnswer[]>;
  saveRequiredInfoAnswer(
    userId: string,
    fieldId: RequiredFieldId,
    patch: Partial<{ mode: RequiredFieldMode; value: string }>
  ): Promise<RequiredInfoAnswer>;

  // --- Job listings --------------------------------------------------------
  // Not user-scoped (a listing is a shared, tenant-agnostic fact — see
  // packages/db schema comments). Stubbed with seed data standing in for
  // real ATS connectors (Greenhouse/Lever/Ashby/Workday).
  listJobListings(): Promise<JobListing[]>;

  // --- Applications --------------------------------------------------------
  listApplications(userId: string): Promise<Application[]>;
  getApplication(userId: string, jobListingId: string): Promise<Application | null>;
  /** Creates the Application row if none exists for (userId, jobListingId), else updates its status. */
  upsertApplicationStatus(
    userId: string,
    jobListingId: string,
    status: ApplicationStatus
  ): Promise<Application>;
  /** Used by "Skip -> Undo" / "cancel review" to return a job to the unactioned state. */
  deleteApplication(userId: string, jobListingId: string): Promise<void>;

  // --- Activity log (ApplicationLogEntry, issue #6) -----------------------
  // PRIVACY-CRITICAL: see lib/types.ts ApplicationLogEntry doc comment.
  // `value_category` must always be a coarse label, never a raw field value.
  /**
   * Lists a user's log entries, optionally scoped to one Application.
   * Always filtered by `userId` — an `applicationId` belonging to a
   * different user must never leak rows (enforced by the implementation,
   * not just by callers passing the right id).
   */
  listApplicationLogEntries(userId: string, applicationId?: string): Promise<ApplicationLogEntry[]>;
  /**
   * Records that a field (or the resume) was submitted on the user's
   * behalf. Implementations must verify `applicationId` actually belongs to
   * `userId` before writing — never trust the caller alone for that scoping.
   */
  createApplicationLogEntry(
    userId: string,
    entry: {
      application_id: string;
      field_label: string;
      value_category: string;
      sent_to: string;
      source: LogEntrySource;
    }
  ): Promise<ApplicationLogEntry>;
}
