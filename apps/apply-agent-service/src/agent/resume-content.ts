import { prisma, decryptField, resumeStorage } from "auto-job-applier-db";
import mammoth from "mammoth";

// ---------------------------------------------------------------------------
// Reads a user's resume through the same seams the Next.js app uses
// (packages/db's ResumeStorage + encryption.ts), for the LLM field-matcher
// to reference when it needs resume content (work history, skills, etc.)
// to answer/fill a field.
//
// Deliberately mirrors apps/web/lib/title-derivation.ts's
// `getResumeContentBlock` (same PDF-as-document-block vs.
// DOCX-extracted-text split, same Anthropic content-block shape) for
// consistency with the only other place in the codebase that already reads
// resumes for an LLM call. Duplicated rather than imported: this service
// does not depend on apps/web (a Next.js app, not an importable package);
// packages/db is the shared layer both go through instead.
// ---------------------------------------------------------------------------

const RESUME_URL_PREFIX = "local-disk://";

export type ResumeContentBlock =
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "text"; text: string };

/** Returns null if the user has no resume uploaded (or it can't be located) -- not an error. */
export async function getResumeContentBlock(userId: string): Promise<ResumeContentBlock | null> {
  const row = await prisma.profile.findUnique({ where: { userId } });
  if (!row?.resumeFileUrlEncrypted || !row.resumeFileName) return null;

  const resumeUrl = await decryptField(Buffer.from(row.resumeFileUrlEncrypted));
  if (!resumeUrl || !resumeUrl.startsWith(RESUME_URL_PREFIX)) return null;

  const objectKey = resumeUrl.slice(RESUME_URL_PREFIX.length);
  const buffer = await resumeStorage.get(objectKey);
  if (!buffer) return null;

  const isPdf = /\.pdf$/i.test(row.resumeFileName) || row.resumeMimeType === "application/pdf";
  if (isPdf) {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
    };
  }
  const result = await mammoth.extractRawText({ buffer });
  return { type: "text", text: `Resume content:\n\n${result.value}` };
}

export interface ResumeFile {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

/** Raw resume bytes for a file-upload field (`fill-file` decisions in field-matcher.ts). */
export async function getResumeFileForUpload(userId: string): Promise<ResumeFile | null> {
  const row = await prisma.profile.findUnique({ where: { userId } });
  if (!row?.resumeFileUrlEncrypted || !row.resumeFileName || !row.resumeMimeType) return null;

  const resumeUrl = await decryptField(Buffer.from(row.resumeFileUrlEncrypted));
  if (!resumeUrl || !resumeUrl.startsWith(RESUME_URL_PREFIX)) return null;

  const objectKey = resumeUrl.slice(RESUME_URL_PREFIX.length);
  const buffer = await resumeStorage.get(objectKey);
  if (!buffer) return null;

  return { fileName: row.resumeFileName, mimeType: row.resumeMimeType, buffer };
}
