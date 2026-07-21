import { prisma, AnswerMode } from "auto-job-applier-db";

// ---------------------------------------------------------------------------
// Loads everything a session needs to start filling an application's form,
// scoped and tenant-checked in one place.
//
// PRIVACY-CRITICAL: `requiredInfoAnswers` below only ever populates `value`
// for fields whose `mode` is "auto". Manual-mode fields always come back
// with `value: null` here -- regardless of whether a value happens to be
// stored -- so the agent's field-matching code structurally never sees a
// manual-mode answer; the human must supply it live (via a `field_input`
// command) every time. This is enforced in this one function, not left to
// callers to remember.
// ---------------------------------------------------------------------------

export interface JobListingContext {
  id: string;
  title: string;
  company: string;
  url: string;
  /**
   * Free-text location from the ATS connector (e.g. "New York, NY",
   * "Remote", "San Francisco Bay Area"), or null if the connector didn't
   * supply one. Used by agent/jurisdiction.ts to derive a best-effort
   * `{ state?, city? }` for the criminal_history ban-the-box gate -- see
   * packages/db/lib/policy/README.md.
   */
  location: string | null;
}

export interface RequiredInfoAnswerContext {
  fieldId: string;
  mode: "auto" | "manual";
  /** Decrypted value. Always null when mode === "manual" -- see file header. */
  value: string | null;
}

export interface ApplicationContext {
  userId: string;
  applicationId: string;
  /**
   * The user's login email (`users.email`). Used as the fallback username
   * when the agent registers an ATS account and no contact email is set --
   * see session/account-provisioner.ts.
   */
  accountEmail: string;
  jobListing: JobListingContext;
  profile: {
    locations: string[];
    levels: string[];
    targetTitles: string[];
    /**
     * Preferred contact address for applications, or null to fall back to
     * `accountEmail`. Not sensitive (plain column -- see schema.prisma's
     * note on Profile's contact fields).
     */
    contactEmail: string | null;
  };
  requiredInfoAnswers: RequiredInfoAnswerContext[];
}

export class ApplicationNotFoundError extends Error {
  constructor(applicationId: string) {
    super(`No application ${applicationId} found for this user.`);
    this.name = "ApplicationNotFoundError";
  }
}

export async function loadApplicationContext(userId: string, applicationId: string): Promise<ApplicationContext> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { jobListing: true },
  });
  if (!application || application.userId !== userId) {
    throw new ApplicationNotFoundError(applicationId);
  }

  const [profileRow, requiredInfoRows, userRow] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.requiredInfoAnswer.findMany({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ]);

  // NOTE: decryptField is intentionally NOT imported/called for manual-mode
  // rows below -- see the file header. Only `auto` mode ever reaches
  // decryptField, imported lazily via a dynamic-free static import kept
  // local to the auto branch would be awkward in TS, so instead we just
  // never read `row.valueEncrypted` at all when mode is manual.
  const { decryptField } = await import("auto-job-applier-db");
  const requiredInfoAnswers: RequiredInfoAnswerContext[] = await Promise.all(
    requiredInfoRows.map(async (row): Promise<RequiredInfoAnswerContext> => {
      if (row.mode !== AnswerMode.AUTO) {
        return { fieldId: row.fieldId, mode: "manual", value: null };
      }
      const value = row.valueEncrypted ? await decryptField(Buffer.from(row.valueEncrypted)) : null;
      return { fieldId: row.fieldId, mode: "auto", value };
    }),
  );

  return {
    userId,
    applicationId,
    accountEmail: userRow?.email ?? "",
    jobListing: {
      id: application.jobListing.id,
      title: application.jobListing.title,
      company: application.jobListing.company,
      url: application.jobListing.url,
      location: application.jobListing.location,
    },
    profile: {
      locations: profileRow?.locations ?? [],
      levels: (profileRow?.levels ?? []).map(String),
      targetTitles: profileRow?.targetTitles ?? [],
      contactEmail: profileRow?.contactEmail ?? null,
    },
    requiredInfoAnswers,
  };
}
