// ---------------------------------------------------------------------------
// Encryption seam.
//
// Settled direction (see packages/db/README.md): application-layer envelope
// encryption. Postgres never stores plaintext for sensitive columns
// (Profile.resume_file_url, RequiredInfoAnswer.value) — only ciphertext. The
// repository implementation is the seam: callers above the repository (API
// routes, UI) only ever see/pass plaintext domain objects.
//
// The *real* encrypt/decrypt implementation is expected to live in the
// `auto-job-applier-db` package (packages/db) so this Next.js app and the
// future browser-orchestration apply-agent service share one crypto path
// and one key-management story. That package doesn't exist yet on this
// branch (issue #2, branch agent/postgres-schema, still in progress), so
// this file is a placeholder that:
//   1. Defines the `EncryptionProvider` shape the real helper is expected
//      to satisfy, so the repository code written against it doesn't need
//      to change when the real implementation is swapped in.
//   2. Ships a no-op provider for the in-memory stub — it does NOT encrypt
//      anything. That's acceptable for a throwaway dev stub holding no real
//      user data, but it must never be used once a real datastore is wired
//      up.
//
// TODO(merge / issue #2): replace `NoopEncryptionProvider` with an import
// of the real provider from `auto-job-applier-db`, and delete this file's
// placeholder implementation (keep the interface if useful, or import it
// from the db package if it exports one).
// ---------------------------------------------------------------------------

export interface EncryptionProvider {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

/**
 * Does not encrypt. Passes plaintext through, tagged so it's obvious in
 * storage/debugging that this is not real ciphertext.
 *
 * TODO(issue #2 / KMS decision, not settled): once a real provider exists,
 * it should pull its key from a pluggable key-provider abstraction
 * (env-var-backed key acceptable for dev) rather than hardcoding a provider
 * here.
 */
export class NoopEncryptionProvider implements EncryptionProvider {
  async encrypt(plaintext: string): Promise<string> {
    return `noop-stub-unencrypted:${plaintext}`;
  }

  async decrypt(ciphertext: string): Promise<string> {
    const prefix = "noop-stub-unencrypted:";
    return ciphertext.startsWith(prefix) ? ciphertext.slice(prefix.length) : ciphertext;
  }
}

export const encryptionProvider: EncryptionProvider = new NoopEncryptionProvider();
