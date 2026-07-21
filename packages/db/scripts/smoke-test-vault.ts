// ---------------------------------------------------------------------------
// End-to-end smoke test for the credential vault, against a real database.
//
// Run from packages/db with:
//
//   npm run test:smoke
//
// Run with tsx, not bare node: lib/ uses extensionless relative imports (it
// has to -- see the note at the top of lib/credential-vault.ts), and Node's
// ESM resolver does no extension inference, so `node --experimental-strip-types`
// cannot load it.
//
// Unit tests (lib/**/*.test.ts) cover the pure logic -- the allowlist and the
// password generator -- and deliberately touch neither Postgres nor the
// encryption key. This script covers what they structurally cannot:
//
//   - that ciphertext, not plaintext, is what actually lands in the column
//   - that FIELD_ENCRYPTION_KEY decrypts what it encrypted, across a real
//     write/read cycle rather than in-process
//   - that the list path doesn't carry a password
//   - that a reveal leaves an audit row
//
// Creates a throwaway user, exercises the vault, and deletes everything it
// made. Safe to run repeatedly against a dev database. Do not point it at
// anything you care about -- it writes real rows before cleaning them up.
// ---------------------------------------------------------------------------

import { prisma } from "../lib/client";
import {
  saveCredential,
  listCredentials,
  revealCredential,
  findCredentialForUrl,
  createRevealChallenge,
  redeemRevealChallenge,
  isRevealUnlocked,
} from "../lib/credential-vault";

const TEST_EMAIL = `vault-smoke-test-${Date.now()}@example.invalid`;
const TEST_URL = "https://acme.wd5.myworkdayjobs.com/en-US/careers/login";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/**
 * Fails early and legibly on a missing environment, rather than letting
 * Prisma throw a stack trace about a missing datasource URL.
 *
 * Worth knowing: only the Prisma *CLI* auto-loads packages/db/.env. The
 * generated client does not, and neither does node -- which is why the npm
 * script passes `--env-file=.env`. (The connectors under connectors/ have
 * the same latent dependency on the shell already having these exported.)
 */
function requireEnv(): void {
  const missing = ["DATABASE_URL", "FIELD_ENCRYPTION_KEY"].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `\nMissing required environment variable(s): ${missing.join(", ")}\n\n` +
        `These live in packages/db/.env. Run this via \`npm run test:smoke\`, which\n` +
        `passes --env-file=.env, rather than invoking the script directly.\n`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  requireEnv();
  console.log(`\nCredential vault smoke test\ndatabase: ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ":***@")}\n`);

  const user = await prisma.user.create({ data: { email: TEST_EMAIL } });

  try {
    // --- write -------------------------------------------------------------
    console.log("-- save --");
    const saved = await saveCredential({
      userId: user.id,
      url: TEST_URL,
      username: "smoke-test@example.invalid",
      createdByAgent: true,
    });
    check("saveCredential succeeds on an allowlisted domain", saved.ok);
    if (!saved.ok) throw new Error("cannot continue without a saved credential");

    const generated = saved.password;
    check("a password was generated", generated.length >= 24);
    check("registrable domain stored, not full hostname", saved.credential.domain === "myworkdayjobs.com", saved.credential.domain);
    check("origin hostname retained for audit", saved.credential.originHostname === "acme.wd5.myworkdayjobs.com");

    // --- the column really holds ciphertext ---------------------------------
    console.log("\n-- encryption at rest --");
    const raw = await prisma.portalCredential.findUniqueOrThrow({
      where: { id: saved.credential.id },
      select: { passwordEncrypted: true },
    });
    const rawBytes = Buffer.from(raw.passwordEncrypted);
    check("column is not the plaintext password", !rawBytes.toString("utf8").includes(generated));
    check("column has an IV + auth tag + body", rawBytes.length >= 12 + 16 + 1);
    check(
      "plaintext appears nowhere in the raw bytes (hex scan)",
      !rawBytes.toString("hex").includes(Buffer.from(generated, "utf8").toString("hex")),
    );

    // --- list path carries no password --------------------------------------
    console.log("\n-- list --");
    const listed = await listCredentials(user.id);
    check("credential appears in the list", listed.length === 1);
    check(
      "no password field on the listed object",
      !JSON.stringify(listed).toLowerCase().includes(generated.toLowerCase()),
    );
    check(
      "no ciphertext field on the listed object either",
      !Object.keys(listed[0] ?? {}).some((k) => k.toLowerCase().includes("encrypted")),
    );

    // --- reveal round-trips --------------------------------------------------
    console.log("\n-- reveal --");
    const revealed = await revealCredential(user.id, saved.credential.id, { revealedBy: "ui" });
    check("reveal returns a password", revealed !== null);
    check("decrypted value matches what was stored", revealed?.password === generated);
    check("lastRevealedAt was stamped", revealed?.credential.lastRevealedAt !== null);

    const auditRows = await prisma.credentialRevealEvent.findMany({ where: { userId: user.id } });
    check("reveal wrote exactly one audit row", auditRows.length === 1, `got ${auditRows.length}`);
    check("audit row records the source", auditRows[0]?.revealedBy === "ui");
    check(
      "audit row holds no password",
      !JSON.stringify(auditRows).includes(generated),
    );

    // --- tenant isolation -----------------------------------------------------
    console.log("\n-- tenant isolation --");
    const otherUser = await prisma.user.create({
      data: { email: `vault-smoke-other-${Date.now()}@example.invalid` },
    });
    const stolen = await revealCredential(otherUser.id, saved.credential.id, { revealedBy: "ui" });
    check("another user cannot reveal this credential", stolen === null);
    await prisma.user.delete({ where: { id: otherUser.id } });

    // --- agent lookup path ----------------------------------------------------
    console.log("\n-- agent lookup --");
    const found = await findCredentialForUrl(user.id, "https://globex.wd3.myworkdayjobs.com/careers");
    check("a different Workday tenant matches the same credential", found?.password === generated);

    const phish = await findCredentialForUrl(user.id, "https://myworkdayjobs.com.evil.example/login");
    check("a lookalike domain matches nothing", phish === null);

    const wrongVendor = await findCredentialForUrl(user.id, "https://boards.greenhouse.io/acme");
    check("an unrelated allowlisted vendor matches nothing", wrongVendor === null);

    // --- re-auth challenge ------------------------------------------------------
    console.log("\n-- reveal challenge --");
    check("vault starts locked", (await isRevealUnlocked(user.id)) === false);
    const code = await createRevealChallenge(user.id);
    check("challenge code is 6 digits", /^\d{6}$/.test(code));

    const wrong = await redeemRevealChallenge(user.id, code === "000000" ? "111111" : "000000");
    check("a wrong code is rejected", wrong.ok === false);
    check("a wrong code does not unlock", (await isRevealUnlocked(user.id)) === false);

    const right = await redeemRevealChallenge(user.id, code);
    check("the correct code is accepted", right.ok === true);
    check("vault is now unlocked", (await isRevealUnlocked(user.id)) === true);

    const replay = await redeemRevealChallenge(user.id, code);
    check("the same code cannot be redeemed twice", replay.ok === false);

    // --- allowlist enforcement at the write path ---------------------------------
    console.log("\n-- allowlist on write --");
    for (const [name, url] of [
      ["lookalike suffix", "https://evil-greenhouse.io/signup"],
      ["lookalike prefix", "https://greenhouse.io.evil.example/signup"],
      ["plain http", "http://boards.greenhouse.io/signup"],
      ["unlisted vendor", "https://jobs.example.com/signup"],
    ] as const) {
      const result = await saveCredential({ userId: user.id, url, username: "x@example.invalid" });
      check(`refuses to store for ${name}`, result.ok === false);
    }
    const stored = await prisma.portalCredential.count({ where: { userId: user.id } });
    check("no extra rows were written by the refused saves", stored === 1, `count=${stored}`);
  } finally {
    // Cascades to credentials, challenges, and audit rows.
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nSmoke test crashed:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
