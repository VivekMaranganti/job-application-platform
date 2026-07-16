import {
  AnswerMode,
  ApplicationStatus as PrismaApplicationStatus,
  CompanySize as PrismaCompanySize,
  DatePosted as PrismaDatePosted,
  EmploymentType as PrismaEmploymentType,
  ProfileLevel,
  WorkArrangement as PrismaWorkArrangement,
} from "auto-job-applier-db";
import type {
  ApplicationStatus,
  CompanySize,
  DatePosted,
  EmploymentType,
  Level,
  RequiredFieldMode,
  WorkArrangement,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Domain <-> Prisma enum mapping.
//
// Prisma's generated client types use the enum *identifier* (e.g.
// `ProfileLevel.STAFF_PRINCIPAL`), not the `@map`'d display label stored in
// Postgres (`"Staff / Principal"`) -- the `@map` only affects the native DB
// enum's on-disk label, not the client-side TS representation. The app's
// domain types (lib/types.ts) use the display label directly as the literal
// type (`Level = "Staff / Principal" | ...`), so every enum needs an
// explicit two-way lookup rather than a case-conversion trick (several
// labels, e.g. "Enterprise (5,000+)", don't round-trip through one).
//
// This is the "mapping helper" flagged as an open TODO in
// packages/db/README.md ("Integrating with the Next.js scaffold").
// ---------------------------------------------------------------------------

function invert<K extends string, V extends string>(map: Record<K, V>): Record<V, K> {
  const out = {} as Record<V, K>;
  for (const key in map) out[map[key]] = key;
  return out;
}

const LEVEL_TO_PRISMA: Record<Level, ProfileLevel> = {
  "Entry level": ProfileLevel.ENTRY_LEVEL,
  "Mid level": ProfileLevel.MID_LEVEL,
  Senior: ProfileLevel.SENIOR,
  "Staff / Principal": ProfileLevel.STAFF_PRINCIPAL,
  Manager: ProfileLevel.MANAGER,
  Director: ProfileLevel.DIRECTOR,
  "Executive / VP": ProfileLevel.EXECUTIVE_VP,
};
const PRISMA_TO_LEVEL = invert(LEVEL_TO_PRISMA);

const WORK_ARRANGEMENT_TO_PRISMA: Record<WorkArrangement, PrismaWorkArrangement> = {
  Remote: PrismaWorkArrangement.REMOTE,
  Hybrid: PrismaWorkArrangement.HYBRID,
  Onsite: PrismaWorkArrangement.ONSITE,
};
const PRISMA_TO_WORK_ARRANGEMENT = invert(WORK_ARRANGEMENT_TO_PRISMA);

const EMPLOYMENT_TYPE_TO_PRISMA: Record<EmploymentType, PrismaEmploymentType> = {
  "Full-time": PrismaEmploymentType.FULL_TIME,
  "Part-time": PrismaEmploymentType.PART_TIME,
  Contract: PrismaEmploymentType.CONTRACT,
  Internship: PrismaEmploymentType.INTERNSHIP,
};
const PRISMA_TO_EMPLOYMENT_TYPE = invert(EMPLOYMENT_TYPE_TO_PRISMA);

const COMPANY_SIZE_TO_PRISMA: Record<CompanySize, PrismaCompanySize> = {
  "Startup (1-50)": PrismaCompanySize.STARTUP,
  "Small-mid (51-500)": PrismaCompanySize.SMALL_MID,
  "Large (501-5,000)": PrismaCompanySize.LARGE,
  "Enterprise (5,000+)": PrismaCompanySize.ENTERPRISE,
};
const PRISMA_TO_COMPANY_SIZE = invert(COMPANY_SIZE_TO_PRISMA);

const DATE_POSTED_TO_PRISMA: Record<DatePosted, PrismaDatePosted> = {
  "Any time": PrismaDatePosted.ANY_TIME,
  "Past 24 hours": PrismaDatePosted.PAST_DAY,
  "Past week": PrismaDatePosted.PAST_WEEK,
  "Past month": PrismaDatePosted.PAST_MONTH,
};
const PRISMA_TO_DATE_POSTED = invert(DATE_POSTED_TO_PRISMA);

const MODE_TO_PRISMA: Record<RequiredFieldMode, AnswerMode> = {
  auto: AnswerMode.AUTO,
  manual: AnswerMode.MANUAL,
};
const PRISMA_TO_MODE = invert(MODE_TO_PRISMA);

const APPLICATION_STATUS_TO_PRISMA: Record<ApplicationStatus, PrismaApplicationStatus> = {
  matched: PrismaApplicationStatus.MATCHED,
  reviewing: PrismaApplicationStatus.REVIEWING,
  in_progress: PrismaApplicationStatus.IN_PROGRESS,
  needs_input: PrismaApplicationStatus.NEEDS_INPUT,
  ready_for_review: PrismaApplicationStatus.READY_FOR_REVIEW,
  submitted: PrismaApplicationStatus.SUBMITTED,
  skipped: PrismaApplicationStatus.SKIPPED,
  failed: PrismaApplicationStatus.FAILED,
};
const PRISMA_TO_APPLICATION_STATUS = invert(APPLICATION_STATUS_TO_PRISMA);

export const toPrismaLevel = (v: Level): ProfileLevel => LEVEL_TO_PRISMA[v];
export const fromPrismaLevel = (v: ProfileLevel): Level => PRISMA_TO_LEVEL[v];

export const toPrismaWorkArrangement = (v: WorkArrangement): PrismaWorkArrangement =>
  WORK_ARRANGEMENT_TO_PRISMA[v];
export const fromPrismaWorkArrangement = (v: PrismaWorkArrangement): WorkArrangement =>
  PRISMA_TO_WORK_ARRANGEMENT[v];

export const toPrismaEmploymentType = (v: EmploymentType): PrismaEmploymentType =>
  EMPLOYMENT_TYPE_TO_PRISMA[v];
export const fromPrismaEmploymentType = (v: PrismaEmploymentType): EmploymentType =>
  PRISMA_TO_EMPLOYMENT_TYPE[v];

export const toPrismaCompanySize = (v: CompanySize): PrismaCompanySize => COMPANY_SIZE_TO_PRISMA[v];
export const fromPrismaCompanySize = (v: PrismaCompanySize): CompanySize => PRISMA_TO_COMPANY_SIZE[v];

export const toPrismaDatePosted = (v: DatePosted): PrismaDatePosted => DATE_POSTED_TO_PRISMA[v];
export const fromPrismaDatePosted = (v: PrismaDatePosted): DatePosted => PRISMA_TO_DATE_POSTED[v];

export const toPrismaMode = (v: RequiredFieldMode): AnswerMode => MODE_TO_PRISMA[v];
export const fromPrismaMode = (v: AnswerMode): RequiredFieldMode => PRISMA_TO_MODE[v];

export const toPrismaApplicationStatus = (v: ApplicationStatus): PrismaApplicationStatus =>
  APPLICATION_STATUS_TO_PRISMA[v];
export const fromPrismaApplicationStatus = (v: PrismaApplicationStatus): ApplicationStatus =>
  PRISMA_TO_APPLICATION_STATUS[v];
