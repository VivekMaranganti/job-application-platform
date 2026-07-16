/**
 * Application-layer envelope encryption for sensitive columns.
 *
 * Postgres never encrypts or decrypts anything for this project -- there is
 * no pgcrypto, no DB-side crypto function, and no key material anywhere near
 * the database. The columns that hold sensitive data (`profiles
 * .resume_file_url_encrypted`, `required_info_answers.value_encrypted`) are
 * typed as `bytea` / Prisma `Bytes` and store nothing but the ciphertext
 * produced by this module. The database only ever sees opaque bytes.
 *
 * This module is the encrypt/decrypt seam. The repository layer in the
 * Next.js app (or any other service that ends up writing to these tables --
 * e.g. a future browser-orchestration apply-agent) should call
 * `encryptField` before every write and `decryptField` after every read of
 * those columns. Nothing else in the codebase should touch AES directly.
 *
 * Algorithm: AES-256-GCM.
 *   - 12-byte random IV per encryption (never reused with the same key).
 *   - 16-byte GCM auth tag, so tampering/corruption is detected on decrypt
 *     rather than silently producing garbage plaintext.
 *   - Wire format stored in the DB column: iv (12 bytes) || authTag (16
 *     bytes) || ciphertext (variable). Self-contained -- nothing else needs
 *     to be stored alongside it to decrypt later.
 *
 * Key management is intentionally pluggable via `KeyProvider`. Which KMS /
 * secret manager backs this in production is not decided yet (tied to a
 * hosting decision that hasn't been made) -- `EnvKeyProvider` below is the
 * dev/test default (a base64 key from an environment variable) and is NOT
 * sufficient for production. Swap in a KMS-backed `KeyProvider`
 * implementation later without touching any call site.
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32; // AES-256

/**
 * Supplies the symmetric data-encryption key used for envelope encryption.
 * Implementations are swappable: dev/test can read from an env var, prod
 * should wrap a KMS/secrets-manager-backed key. Callers should never assume
 * a specific backing mechanism.
 */
export interface KeyProvider {
  /** Returns the current 32-byte (AES-256) data-encryption key. */
  getDataKey(): Promise<Buffer>;
}

/**
 * Dev/test key provider: reads a base64-encoded 32-byte key from an
 * environment variable (default `FIELD_ENCRYPTION_KEY`).
 *
 * NOT sufficient for production use -- there is no rotation, no audit
 * trail, and the key lives wherever the process env lives. Production
 * should implement `KeyProvider` against a real KMS (AWS KMS, GCP KMS,
 * Vault, etc.) once a hosting provider is chosen, ideally using envelope
 * encryption (a KMS-wrapped data key cached in memory, not the KMS master
 * key itself used directly per field).
 */
export class EnvKeyProvider implements KeyProvider {
  private readonly envVarName: string;
  private cachedKey: Buffer | undefined;

  constructor(envVarName = "FIELD_ENCRYPTION_KEY") {
    this.envVarName = envVarName;
  }

  async getDataKey(): Promise<Buffer> {
    if (this.cachedKey) return this.cachedKey;

    const raw = process.env[this.envVarName];
    if (!raw) {
      throw new Error(
        `${this.envVarName} is not set. Generate one with: ` +
          `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`,
      );
    }

    const key = Buffer.from(raw, "base64");
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `${this.envVarName} must decode to exactly ${KEY_LENGTH_BYTES} bytes ` +
          `(got ${key.length}). It must be a base64-encoded AES-256 key.`,
      );
    }

    this.cachedKey = key;
    return key;
  }
}

/** Default provider used when callers don't supply their own. */
const defaultKeyProvider = new EnvKeyProvider();

/**
 * Encrypts a plaintext string for storage in a `bytea`/`Bytes` column.
 * Returns `null` unchanged so callers can pass through optional fields
 * (e.g. a resume URL that hasn't been uploaded yet) without a branch.
 */
export async function encryptField(
  plaintext: string | null | undefined,
  keyProvider: KeyProvider = defaultKeyProvider,
): Promise<Buffer | null> {
  if (plaintext === null || plaintext === undefined) return null;

  const key = await keyProvider.getDataKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]);
}

/**
 * Decrypts a `bytea`/`Bytes` column value produced by `encryptField`.
 * Returns `null` unchanged for `null` input (e.g. a field that was never
 * set). Throws if the tag doesn't verify -- treat that as corruption/
 * tampering, not as "empty".
 */
export async function decryptField(
  blob: Buffer | null | undefined,
  keyProvider: KeyProvider = defaultKeyProvider,
): Promise<string | null> {
  if (blob === null || blob === undefined) return null;

  if (blob.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    throw new Error(
      "Ciphertext blob is too short to contain an IV and auth tag -- data is corrupt or was never encrypted with this scheme.",
    );
  }

  const key = await keyProvider.getDataKey();
  const iv = blob.subarray(0, IV_LENGTH_BYTES);
  const authTag = blob.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const ciphertext = blob.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
