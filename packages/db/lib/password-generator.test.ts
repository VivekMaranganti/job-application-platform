// Run with:  node --test packages/db/lib/password-generator.test.ts
// See account-creation-allowlist.test.ts for why node:test and not a framework.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePassword } from "./password-generator.ts";

test("meets the character-class rules ATS signup forms impose", () => {
  for (let i = 0; i < 200; i++) {
    const pw = generatePassword();
    assert.equal(pw.length, 24);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[0-9]/);
    assert.match(pw, /[!#$%*+\-=?@^_]/);
  }
});

test("excludes visually ambiguous characters", () => {
  // l/1/I and O/0 are the pairs people misread when copying a password by
  // eye out of the reveal UI.
  for (let i = 0; i < 200; i++) {
    assert.doesNotMatch(generatePassword(), /[l1IO0]/);
  }
});

test("does not cluster the guaranteed characters at a fixed position", () => {
  // The common bug is appending the four required characters, which makes
  // the tail predictable in *kind* ("...Aa1!") even though the values are
  // random. If that were happening here, every sample would have a symbol
  // in its last four characters.
  const samples = Array.from({ length: 2000 }, () => generatePassword());
  const symbolInTail = samples.filter((p) => /[!#$%*+\-=?@^_]/.test(p.slice(-4))).length;
  const rate = symbolInTail / samples.length;
  assert.ok(rate < 0.9, `symbol-in-tail rate ${rate} suggests the tail is structured`);
  assert.ok(rate > 0.1, `symbol-in-tail rate ${rate} suggests symbols never reach the tail`);
});

test("does not repeat", () => {
  const samples = new Set(Array.from({ length: 2000 }, () => generatePassword()));
  assert.equal(samples.size, 2000);
});

test("refuses to generate a weak password", () => {
  assert.throws(() => generatePassword(8), /Refusing/);
});
