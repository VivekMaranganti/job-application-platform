// ---------------------------------------------------------------------------
// Package entry point for `auto-job-applier-db`.
//
// Consumers (the Next.js app's Postgres-backed Repository today; any future
// service -- e.g. the browser-orchestration apply-agent -- later) import
// everything through this one path rather than reaching into `lib/`, so the
// package's internal layout can change without touching call sites.
// ---------------------------------------------------------------------------

export * from "@prisma/client";
export { prisma } from "./lib/client";
export { AesGcmEncryptionProvider, encryptionProvider } from "./lib/encryption-provider";
export { encryptField, decryptField, EnvKeyProvider } from "./lib/encryption";
export type { KeyProvider } from "./lib/encryption";
export { LocalDiskResumeStorage, resumeStorage } from "./lib/resume-storage";
export type { ResumeStorage } from "./lib/resume-storage";
