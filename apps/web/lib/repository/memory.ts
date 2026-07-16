import type {
  Application,
  ApplicationStatus,
  Filters,
  JobListing,
  Profile,
  RequiredFieldId,
  RequiredFieldMode,
  RequiredInfoAnswer,
} from "@/lib/types";
import type { Repository } from "./types";
import { encryptionProvider } from "./encryption";
import { seedJobListings } from "./seed-jobs";

// ---------------------------------------------------------------------------
// In-memory repository stub.
//
// Deliberately simple per issue #1's instructions ("don't over-engineer the
// stub") — data lives in module-scope Maps and is lost on server restart.
// It exists purely so the app is fully functional standalone while issue #2
// builds the real Postgres schema on a separate branch. See
// packages/db/README.md for how this gets rewired at merge time.
//
// State is stashed on `globalThis` so Next.js dev-server hot-reloads (which
// re-evaluate this module) don't wipe in-memory data on every edit.
// ---------------------------------------------------------------------------

interface MemoryStore {
  profiles: Map<string, Profile>;
  resumeFiles: Map<string, { fileName: string; mimeType: string; buffer: Buffer }>;
  filters: Map<string, Filters>;
  requiredInfoAnswers: Map<string, Map<RequiredFieldId, RequiredInfoAnswer>>;
  jobListings: JobListing[];
  applications: Map<string, Application>; // keyed by `${userId}::${jobListingId}`
}

const globalForStore = globalThis as unknown as { __memoryStore?: MemoryStore };

function createStore(): MemoryStore {
  return {
    profiles: new Map(),
    resumeFiles: new Map(),
    filters: new Map(),
    requiredInfoAnswers: new Map(),
    jobListings: seedJobListings(),
    applications: new Map(),
  };
}

const store = globalForStore.__memoryStore ?? createStore();
globalForStore.__memoryStore = store;

function emptyProfile(userId: string): Profile {
  return {
    user_id: userId,
    resume_file_url: null,
    resume_uploaded_at: null,
    resume_file_name: null,
    resume_file_size: null,
    locations: [],
    levels: [],
    target_titles: [],
  };
}

function emptyFilters(userId: string): Filters {
  return {
    user_id: userId,
    work_arrangement: [],
    employment_type: [],
    company_size: [],
    salary_min: null,
    date_posted: "Any time",
    industries: [],
    exclude_companies: [],
    special_instructions: "",
  };
}

function applicationKey(userId: string, jobListingId: string): string {
  return `${userId}::${jobListingId}`;
}

let nextResumeId = 1;
let nextApplicationId = 1;

/**
 * `store.profiles` holds `resume_file_url` as ciphertext (the encryption
 * seam applies here too, same as RequiredInfoAnswer.value). This decrypts
 * it for the plaintext domain object callers receive.
 */
async function toPublicProfile(p: Profile): Promise<Profile> {
  if (!p.resume_file_url) return p;
  return { ...p, resume_file_url: await encryptionProvider.decrypt(p.resume_file_url) };
}

export const memoryRepository: Repository = {
  async getProfile(userId) {
    return toPublicProfile(store.profiles.get(userId) ?? emptyProfile(userId));
  },

  async saveProfile(userId, patch) {
    const current = store.profiles.get(userId) ?? emptyProfile(userId);
    const updated: Profile = { ...current, ...patch };
    store.profiles.set(userId, updated);
    return toPublicProfile(updated);
  },

  async saveResume(userId, file) {
    const current = store.profiles.get(userId) ?? emptyProfile(userId);
    // Sensitive: encrypted at rest per the settled encryption-boundary
    // decision (see encryption.ts). The stub's provider is a no-op today,
    // but the call sits at the seam a real provider would occupy.
    const resumeId = `resume_${nextResumeId++}`;
    const encryptedUrl = await encryptionProvider.encrypt(`local-stub://resumes/${resumeId}`);
    store.resumeFiles.set(userId, {
      fileName: file.fileName,
      mimeType: file.mimeType,
      buffer: file.buffer,
    });
    const updated: Profile = {
      ...current,
      resume_file_url: encryptedUrl,
      resume_uploaded_at: new Date().toISOString(),
      resume_file_name: file.fileName,
      resume_file_size: file.fileSize,
    };
    store.profiles.set(userId, updated);
    return toPublicProfile(updated);
  },

  async removeResume(userId) {
    const current = store.profiles.get(userId) ?? emptyProfile(userId);
    store.resumeFiles.delete(userId);
    const updated: Profile = {
      ...current,
      resume_file_url: null,
      resume_uploaded_at: null,
      resume_file_name: null,
      resume_file_size: null,
    };
    store.profiles.set(userId, updated);
    return updated;
  },

  async getResumeFile(userId) {
    return store.resumeFiles.get(userId) ?? null;
  },

  async getFilters(userId) {
    return store.filters.get(userId) ?? emptyFilters(userId);
  },

  async saveFilters(userId, patch) {
    const current = store.filters.get(userId) ?? emptyFilters(userId);
    const updated: Filters = { ...current, ...patch };
    store.filters.set(userId, updated);
    return updated;
  },

  async getRequiredInfoAnswers(userId) {
    const userAnswers = store.requiredInfoAnswers.get(userId);
    if (!userAnswers) return [];
    return Promise.all(
      Array.from(userAnswers.values()).map(async (a) => ({
        ...a,
        value: await encryptionProvider.decrypt(a.value),
      }))
    );
  },

  async saveRequiredInfoAnswer(userId, fieldId, patch) {
    let userAnswers = store.requiredInfoAnswers.get(userId);
    if (!userAnswers) {
      userAnswers = new Map();
      store.requiredInfoAnswers.set(userId, userAnswers);
    }
    const current: RequiredInfoAnswer = userAnswers.get(fieldId) ?? {
      user_id: userId,
      field_id: fieldId,
      mode: "manual" as RequiredFieldMode,
      value: "",
    };
    // Sensitive: `value` is encrypted at rest — see encryption.ts. We
    // round-trip through encrypt/decrypt even in the stub so the seam is
    // exercised, not just documented.
    const nextValue = patch.value !== undefined ? patch.value : await encryptionProvider.decrypt(current.value);
    const updated: RequiredInfoAnswer = {
      user_id: userId,
      field_id: fieldId,
      mode: patch.mode ?? current.mode,
      value: await encryptionProvider.encrypt(nextValue),
    };
    userAnswers.set(fieldId, updated);
    return { ...updated, value: nextValue };
  },

  async listJobListings() {
    return store.jobListings;
  },

  async listApplications(userId) {
    return Array.from(store.applications.values()).filter((a) => a.user_id === userId);
  },

  async getApplication(userId, jobListingId) {
    return store.applications.get(applicationKey(userId, jobListingId)) ?? null;
  },

  async upsertApplicationStatus(userId, jobListingId, status: ApplicationStatus) {
    const key = applicationKey(userId, jobListingId);
    const existing = store.applications.get(key);
    const updated: Application = existing
      ? { ...existing, status, submitted_at: status === "submitted" ? new Date().toISOString() : existing.submitted_at }
      : {
          id: `app_${nextApplicationId++}`,
          user_id: userId,
          job_listing_id: jobListingId,
          status,
          created_at: new Date().toISOString(),
          submitted_at: status === "submitted" ? new Date().toISOString() : null,
        };
    store.applications.set(key, updated);
    return updated;
  },

  async deleteApplication(userId, jobListingId) {
    store.applications.delete(applicationKey(userId, jobListingId));
  },
};
