/**
 * Adapter exposing `encryptField`/`decryptField` (see `encryption.ts`) as a
 * class shaped like the Next.js scaffold's `EncryptionProvider` interface
 * (`apps/web/lib/repository/encryption.ts`, branch `agent/scaffold-nextjs`):
 *
 *   interface EncryptionProvider {
 *     encrypt(plaintext: string): Promise<string>;
 *     decrypt(ciphertext: string): Promise<string>;
 *   }
 *
 * That interface isn't imported here -- this package and the scaffold live
 * on unmerged branches, so there's nothing to import yet. The method
 * signatures below are kept in sync with it by hand; TypeScript's structural
 * typing means `AesGcmEncryptionProvider` will satisfy `EncryptionProvider`
 * as soon as the scaffold's repository layer depends on this package,
 * without either side needing an explicit `implements` clause across the
 * package boundary. (Once merged, re-pointing the scaffold's
 * `EncryptionProvider` import at this file -- or adding an explicit
 * `implements EncryptionProvider` here -- is a one-line change; do that at
 * merge time so the compiler enforces the match going forward.)
 *
 * The scaffold's interface models ciphertext as a `string` end-to-end (its
 * in-memory `NoopEncryptionProvider` stub just tags plaintext with a
 * prefix). `encryptField`/`decryptField` here operate on `Buffer`, matching
 * the `Bytes` Prisma column type. This adapter bridges the two with
 * base64: `encrypt` returns `iv || authTag || ciphertext` base64-encoded,
 * `decrypt` expects the same encoding back.
 */

import {
  decryptField,
  encryptField,
  type KeyProvider,
} from "./encryption";

export class AesGcmEncryptionProvider {
  constructor(private readonly keyProvider?: KeyProvider) {}

  /** Encrypts a plaintext string, returning base64-encoded ciphertext. */
  async encrypt(plaintext: string): Promise<string> {
    const blob = await encryptField(plaintext, this.keyProvider);
    // encryptField only returns null for null/undefined input; `plaintext`
    // here is a required, non-nullable string, so this is never null.
    return blob!.toString("base64");
  }

  /** Decrypts base64-encoded ciphertext produced by `encrypt` back to plaintext. */
  async decrypt(ciphertext: string): Promise<string> {
    const blob = Buffer.from(ciphertext, "base64");
    const plaintext = await decryptField(blob, this.keyProvider);
    // decryptField only returns null for null/undefined input; `ciphertext`
    // here is a required, non-nullable string, so this is never null.
    return plaintext!;
  }
}

/** Default instance, using the default (env-var-backed) `KeyProvider`. */
export const encryptionProvider = new AesGcmEncryptionProvider();
