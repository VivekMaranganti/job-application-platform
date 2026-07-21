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
export {
  isCriminalHistoryAutoModeAllowed,
  resolveRequiredInfoModeForSave,
} from "./lib/policy/criminal-history-jurisdiction";
export type { Jurisdiction } from "./lib/policy/criminal-history-jurisdiction";
export { parseJurisdiction } from "./lib/policy/jurisdiction";
export {
  ALLOWED_ATS_VENDORS,
  checkAccountCreationAllowed,
  isAccountCreationAllowed,
} from "./lib/policy/account-creation-allowlist";
export type {
  AllowedAtsVendor,
  AllowlistDecision,
} from "./lib/policy/account-creation-allowlist";
export { generatePassword } from "./lib/password-generator";
export {
  saveCredential,
  listCredentials,
  revealCredential,
  findCredentialForUrl,
  deleteCredential,
  listRevealEvents,
  createRevealChallenge,
  redeemRevealChallenge,
  isRevealUnlocked,
  getRevealUnlockedUntil,
  REVEAL_UNLOCK_WINDOW_MS,
  MAX_REVEAL_CHALLENGE_ATTEMPTS,
} from "./lib/credential-vault";
export type {
  CredentialSummary,
  SaveCredentialInput,
  SaveCredentialResult,
  RevealContext,
  RedeemResult,
} from "./lib/credential-vault";
