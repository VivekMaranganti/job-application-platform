// ---------------------------------------------------------------------------
// Tests for the signup-vs-login classification.
//
// Run with:  node --test --experimental-strip-types src/browser/auth-wall.test.ts
//
// This decides whether the agent *creates* an account or *looks one up*, so
// getting it wrong in the signup direction means a duplicate account on an
// ATS the user already has one for -- which silently splits their
// application history across two logins and stays invisible until they go
// looking for a submission that isn't there.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAuthWall, type AuthWallSignals } from "./dom-extraction.ts";

function signals(over: Partial<AuthWallSignals> = {}): AuthWallSignals {
  return {
    passwordCount: 1,
    hasExplicitConfirmField: false,
    declaresNewPassword: false,
    bodyTextSample: "",
    passwordSelector: "#password",
    extraFieldSelectors: [],
    ...over,
  };
}

test("no password field means no auth wall", () => {
  assert.equal(classifyAuthWall(signals({ passwordCount: 0 })), null);
  assert.equal(classifyAuthWall(null), null);
});

test("a job description mentioning 'sign in to apply' is not an auth wall", () => {
  // The prose alone must never be enough -- this is the false positive that
  // would stop the agent on ordinary listing pages.
  const result = classifyAuthWall(
    signals({ passwordCount: 0, bodyTextSample: "sign in to apply for this role. create an account today." }),
  );
  assert.equal(result, null);
});

test("a confirm-password field means signup, whatever the prose says", () => {
  const result = classifyAuthWall(
    signals({
      hasExplicitConfirmField: true,
      passwordCount: 2,
      // Header nav says "Sign in" on plenty of registration pages.
      bodyTextSample: "sign in | welcome back",
    }),
  );
  assert.equal(result?.kind, "signup");
});

test("two password fields mean signup", () => {
  assert.equal(classifyAuthWall(signals({ passwordCount: 2 }))?.kind, "signup");
});

test("autocomplete=new-password means signup", () => {
  assert.equal(classifyAuthWall(signals({ declaresNewPassword: true }))?.kind, "signup");
});

test("signup prose with no login prose means signup", () => {
  const result = classifyAuthWall(
    signals({ bodyTextSample: "create an account to continue your application" }),
  );
  assert.equal(result?.kind, "signup");
});

test("a plain single-password form is login", () => {
  const result = classifyAuthWall(signals({ bodyTextSample: "sign in to your account" }));
  assert.equal(result?.kind, "login");
});

test("ambiguous pages resolve to login, not signup", () => {
  // Both vocabularies present, no structural signal. Biasing to signup here
  // is what produces the duplicate-account failure, so it must not happen.
  const result = classifyAuthWall(
    signals({ bodyTextSample: "sign in or create an account to continue" }),
  );
  assert.equal(result?.kind, "login");
});

test("an empty page body with one password field resolves to login", () => {
  assert.equal(classifyAuthWall(signals())?.kind, "login");
});

test("passes selectors through untouched", () => {
  const result = classifyAuthWall(
    signals({
      passwordSelector: "#pw",
      confirmPasswordSelector: "#pw2",
      usernameSelector: "#email",
      submitSelector: "#go",
      extraFieldSelectors: ["#country", "#firstName"],
    }),
  );
  assert.equal(result?.passwordSelector, "#pw");
  assert.equal(result?.confirmPasswordSelector, "#pw2");
  assert.equal(result?.usernameSelector, "#email");
  assert.equal(result?.submitSelector, "#go");
  assert.deepEqual(result?.extraFieldSelectors, ["#country", "#firstName"]);
});
