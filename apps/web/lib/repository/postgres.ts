import { randomUUID } from "node:crypto";
import {
  decryptField,
  encryptField,
  prisma,
  resumeStorage,
  type Profile as PrismaProfile,
} from "auto-job-applier-db";
import type {
  Application,
  ApplicationStatus,
  Filters,
  JobListing,
  Profile,
  RequiredFieldId,
  RequiredInfoAnswer,
  WorkArrangement,
  EmploymentType,
  Level,
  CompanySize,
} from "@/lib/types";
import type { Repository } from "./types";
import { resolveRequiredInfoModeForSave } from "@/lib/policy/criminal-history-jurisdiction";
import {
  fromPrismaApplicationStatus,
  fromPrismaCompanySize,
  fromPrismaDatePosted,
  fromPrismaEmploymentType,
  fromPrismaLevel,
  fromPrismaMode,
  fromPrismaWorkArrangement,
  toPrismaApplicationStatus,
  toPrismaCompanySize,
  toPrismaDatePosted,
  toPrismaEmploymentType,
  toPrismaLevel,
  toPrismaMode,
  toPrismaWorkArrangement,
} from "./mapping";

// ---------------------------------------------------------------------------
// Postgres-backed Repository (issue #2's schema + issue #1's Repository
// seam, wired together). See packages/db/README.md "Integrating with the
// Next.js scaffold" for the mapping gap this file fills in.
//
// Auth (issue #3) isn't decided yet, so every request still resolves to
// `MOCK_USER_ID` (lib/current-user.ts) rather than a real session. Unlike
// the in-memory stub, Postgres enforces a real foreign key from every
// user-scoped table to `users.id` -- `ensureUser` below lazily upserts that
// row so the dev/mock user id has somewhere to point. Delete `ensureUser`
// and its call sites once issue #3 lands with a real signup/session flow
// that creates `users` rows itself.
// ---------------------------------------------------------------------------

const RESUME_URL_PREFIX = "local-disk://";

/**
 * Prisma 6's generated types for `Bytes` columns are `Uint8Array<ArrayBuffer>`,
 * not Node's `Buffer` -- whose generic parameter is the wider
 * `ArrayBufferLike` (a Buffer's backing store could technically be a
 * `SharedArrayBuffer`), so the two don't structurally match even though
 * `Buffer` is a `Uint8Array` at runtime. `encryptField`/`decryptField`
 * (packages/db) operate on real Buffers; these two helpers convert at the
 * handful of call sites that write to / read from a Bytes column.
 */
function toPrismaBytes(buf: Buffer): Uint8Array<ArrayBuffer>;
function toPrismaBytes(buf: Buffer | null): Uint8Array<ArrayBuffer> | null;
function toPrismaBytes(buf: Buffer | null): Uint8Array<ArrayBuffer> | null {
  return buf ? new Uint8Array(buf) : null;
}

function fromPrismaBytes(bytes: Uint8Array | null | undefined): Buffer | null {
  return bytes ? Buffer.from(bytes) : null;
}

async function ensureUser(userId: string): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email: `${userId}@dev.local` },
  });
}

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

async function toDomainProfile(userId: string, row: PrismaProfile | null): Promise<Profile> {
  if (!row) return emptyProfile(userId);
  return {
    user_id: row.userId,
    resume_file_url: row.resumeFileUrlEncrypted
      ? await decryptField(fromPrismaBytes(row.resumeFileUrlEncrypted))
      : null,
    resume_uploaded_at: row.resumeUploadedAt ? row.resumeUploadedAt.toISOString() : null,
    resume_file_name: row.resumeFileName,
    resume_file_size: row.resumeFileSize,
    locations: row.locations,
    levels: row.levels.map(fromPrismaLevel),
    target_titles: row.targetTitles,
  };
}

/** Extracts the ResumeStorage object key from a decrypted `local-disk://...` reference. */
function objectKeyFromResumeUrl(resumeUrl: string): string {
  if (!resumeUrl.startsWith(RESUME_URL_PREFIX)) {
    throw new Error(`Unrecognized resume URL scheme: ${resumeUrl}`);
  }
  return resumeUrl.slice(RESUME_URL_PREFIX.length);
}

export const postgresRepository: Repository = {
  // --- Profile -----------------------------------------------------------
  async getProfile(userId) {
    const row = await prisma.profile.findUnique({ where: { userId } });
    return toDomainProfile(userId, row);
  },

  async saveProfile(userId, patch) {
    await ensureUser(userId);
    const data = {
      ...(patch.locations !== undefined && { locations: patch.locations }),
      ...(patch.levels !== undefined && { levels: patch.levels.map(toPrismaLevel) }),
      ...(patch.target_titles !== undefined && { targetTitles: patch.target_titles }),
    };
    const row = await prisma.profile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toDomainProfile(userId, row);
  },

  async saveResume(userId, file) {
    await ensureUser(userId);
    const objectKey = `resumes/${userId}/${randomUUID()}`;
    await resumeStorage.put(objectKey, { buffer: file.buffer });
    const encryptedUrl = toPrismaBytes(await encryptField(`${RESUME_URL_PREFIX}${objectKey}`));

    const row = await prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        resumeFileUrlEncrypted: encryptedUrl,
        resumeUploadedAt: new Date(),
        resumeFileName: file.fileName,
        resumeFileSize: file.fileSize,
        resumeMimeType: file.mimeType,
      },
      update: {
        resumeFileUrlEncrypted: encryptedUrl,
        resumeUploadedAt: new Date(),
        resumeFileName: file.fileName,
        resumeFileSize: file.fileSize,
        resumeMimeType: file.mimeType,
      },
    });
    return toDomainProfile(userId, row);
  },

  async removeResume(userId) {
    const row = await prisma.profile.update({
      where: { userId },
      data: {
        resumeFileUrlEncrypted: null,
        resumeUploadedAt: null,
        resumeFileName: null,
        resumeFileSize: null,
        resumeMimeType: null,
      },
    });
    return toDomainProfile(userId, row);
  },

  async getResumeFile(userId) {
    const row = await prisma.profile.findUnique({ where: { userId } });
    if (!row?.resumeFileUrlEncrypted || !row.resumeFileName || !row.resumeMimeType) return null;

    const resumeUrl = await decryptField(fromPrismaBytes(row.resumeFileUrlEncrypted));
    const buffer = await resumeStorage.get(objectKeyFromResumeUrl(resumeUrl!));
    if (!buffer) return null;

    return { fileName: row.resumeFileName, mimeType: row.resumeMimeType, buffer };
  },

  // --- Filters -------------------------------------------------------------
  async getFilters(userId) {
    const row = await prisma.filters.findUnique({ where: { userId } });
    if (!row) return emptyFilters(userId);
    return {
      user_id: row.userId,
      work_arrangement: row.workArrangement.map(fromPrismaWorkArrangement),
      employment_type: row.employmentType.map(fromPrismaEmploymentType),
      company_size: row.companySize.map(fromPrismaCompanySize),
      salary_min: row.salaryMin,
      date_posted: fromPrismaDatePosted(row.datePosted),
      industries: row.industries,
      exclude_companies: row.excludeCompanies,
      special_instructions: row.specialInstructions ?? "",
    };
  },

  async saveFilters(userId, patch) {
    await ensureUser(userId);
    const data = {
      ...(patch.work_arrangement !== undefined && {
        workArrangement: patch.work_arrangement.map(toPrismaWorkArrangement),
      }),
      ...(patch.employment_type !== undefined && {
        employmentType: patch.employment_type.map(toPrismaEmploymentType),
      }),
      ...(patch.company_size !== undefined && { companySize: patch.company_size.map(toPrismaCompanySize) }),
      ...(patch.salary_min !== undefined && { salaryMin: patch.salary_min }),
      ...(patch.date_posted !== undefined && { datePosted: toPrismaDatePosted(patch.date_posted) }),
      ...(patch.industries !== undefined && { industries: patch.industries }),
      ...(patch.exclude_companies !== undefined && { excludeCompanies: patch.exclude_companies }),
      ...(patch.special_instructions !== undefined && { specialInstructions: patch.special_instructions }),
    };
    const row = await prisma.filters.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return {
      user_id: row.userId,
      work_arrangement: row.workArrangement.map(fromPrismaWorkArrangement),
      employment_type: row.employmentType.map(fromPrismaEmploymentType),
      company_size: row.companySize.map(fromPrismaCompanySize),
      salary_min: row.salaryMin,
      date_posted: fromPrismaDatePosted(row.datePosted),
      industries: row.industries,
      exclude_companies: row.excludeCompanies,
      special_instructions: row.specialInstructions ?? "",
    };
  },

  // --- Required information ------------------------------------------------
  async getRequiredInfoAnswers(userId) {
    const rows = await prisma.requiredInfoAnswer.findMany({ where: { userId } });
    return Promise.all(
      rows.map(async (row): Promise<RequiredInfoAnswer> => ({
        user_id: row.userId,
        field_id: row.fieldId as RequiredFieldId,
        mode: fromPrismaMode(row.mode),
        value: row.valueEncrypted ? (await decryptField(fromPrismaBytes(row.valueEncrypted))) ?? "" : "",
      }))
    );
  },

  async saveRequiredInfoAnswer(userId, fieldId, patch) {
    await ensureUser(userId);
    // See apps/web/lib/policy/README.md: RequiredInfoAnswer.mode is a
    // single global per-user setting with no concept of which job/
    // jurisdiction it'll be used for, so `criminal_history` can never
    // honestly be persisted as `auto` here -- this unconditionally
    // downgrades that request to `manual` (issue #7). Every other field
    // passes through unchanged.
    const mode = resolveRequiredInfoModeForSave(fieldId, patch.mode);
    let valueEncrypted: Uint8Array<ArrayBuffer> | null | undefined;
    if (patch.value !== undefined) {
      valueEncrypted = toPrismaBytes(await encryptField(patch.value));
    }
    const row = await prisma.requiredInfoAnswer.upsert({
      where: { userId_fieldId: { userId, fieldId } },
      create: {
        userId,
        fieldId,
        mode: mode !== undefined ? toPrismaMode(mode) : undefined,
        valueEncrypted,
      },
      update: {
        ...(mode !== undefined && { mode: toPrismaMode(mode) }),
        ...(valueEncrypted !== undefined && { valueEncrypted }),
      },
    });
    return {
      user_id: row.userId,
      field_id: row.fieldId as RequiredFieldId,
      mode: fromPrismaMode(row.mode),
      value: row.valueEncrypted ? (await decryptField(fromPrismaBytes(row.valueEncrypted))) ?? "" : "",
    };
  },

  // --- Job listings ----------------------------------------------------------
  async listJobListings() {
    const rows = await prisma.jobListing.findMany({ orderBy: { datePosted: "desc" } });
    return rows.map(
      (row): JobListing => ({
        id: row.id,
        source_connector: row.sourceConnector,
        external_id: row.externalId,
        title: row.title,
        company: row.company,
        location: row.location,
        // Free-text classifier columns (see packages/db schema comments) --
        // cast, not mapped: connector data isn't guaranteed to match our
        // closed vocabularies, same looseness the in-memory stub also has.
        remote_type: row.remoteType as WorkArrangement | null,
        employment_type: row.employmentType as EmploymentType | null,
        level: row.level as Level | null,
        salary_min: row.salaryMin,
        salary_max: row.salaryMax,
        company_size: row.companySize as CompanySize | null,
        industry: row.industry,
        date_posted: row.datePosted ? row.datePosted.toISOString() : null,
        url: row.url,
        raw_payload: row.rawPayload,
      })
    );
  },

  // --- Applications ----------------------------------------------------------
  async listApplications(userId) {
    const rows = await prisma.application.findMany({ where: { userId } });
    return rows.map(toDomainApplication);
  },

  async getApplication(userId, jobListingId) {
    const row = await prisma.application.findUnique({
      where: { userId_jobListingId: { userId, jobListingId } },
    });
    return row ? toDomainApplication(row) : null;
  },

  async upsertApplicationStatus(userId, jobListingId, status: ApplicationStatus) {
    await ensureUser(userId);
    const prismaStatus = toPrismaApplicationStatus(status);
    const submittedAt = status === "submitted" ? new Date() : undefined;
    const row = await prisma.application.upsert({
      where: { userId_jobListingId: { userId, jobListingId } },
      create: { userId, jobListingId, status: prismaStatus, submittedAt },
      update: { status: prismaStatus, ...(submittedAt && { submittedAt }) },
    });
    return toDomainApplication(row);
  },

  async deleteApplication(userId, jobListingId) {
    await prisma.application.deleteMany({ where: { userId, jobListingId } });
  },
};

function toDomainApplication(row: {
  id: string;
  userId: string;
  jobListingId: string;
  status: ReturnType<typeof toPrismaApplicationStatus>;
  createdAt: Date;
  submittedAt: Date | null;
}): Application {
  return {
    id: row.id,
    user_id: row.userId,
    job_listing_id: row.jobListingId,
    status: fromPrismaApplicationStatus(row.status),
    created_at: row.createdAt.toISOString(),
    submitted_at: row.submittedAt ? row.submittedAt.toISOString() : null,
  };
}
