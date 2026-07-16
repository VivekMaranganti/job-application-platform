import { prisma, LogEntrySource } from "auto-job-applier-db";
import type { FieldValueCategory } from "../protocol/events";

// ---------------------------------------------------------------------------
// Writes ApplicationLogEntry rows -- the private, structured, textual audit
// trail (separate from any video/screen stream, see browser/screencast.ts).
//
// This is the ONLY function in the service that constructs a row for this
// table, and its parameter list makes it impossible to pass a raw field
// value through: there is no `value` parameter, only `valueCategory`
// (a `FieldValueCategory`, a closed enum-like union) and `fieldLabel` (the
// page's own label text, e.g. "Phone number" -- not sensitive, just a
// caption). Mirrors packages/db/prisma/schema.prisma's ApplicationLogEntry
// comment: "no column of any kind that could hold a raw value".
// ---------------------------------------------------------------------------

export interface LogFieldEntryInput {
  userId: string;
  applicationId: string;
  fieldLabel: string;
  valueCategory: FieldValueCategory;
  /** Where the value was sent -- e.g. the ATS's URL/hostname for this application. */
  sentTo: string;
  /** Mirrors LogEntrySource: did the agent fill this itself, or did a human type it live? */
  source: "auto" | "user-provided-live";
}

export async function logFieldEntry(input: LogFieldEntryInput): Promise<void> {
  await prisma.applicationLogEntry.create({
    data: {
      applicationId: input.applicationId,
      userId: input.userId,
      fieldLabel: input.fieldLabel,
      valueCategory: input.valueCategory,
      sentTo: input.sentTo,
      source: input.source === "auto" ? LogEntrySource.AUTO : LogEntrySource.USER_PROVIDED_LIVE,
    },
  });
}
