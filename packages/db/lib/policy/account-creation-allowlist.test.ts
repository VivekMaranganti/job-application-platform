// ---------------------------------------------------------------------------
// Tests for the account-creation allowlist.
//
// Run with:  node --test packages/db/lib/policy/account-creation-allowlist.test.ts
//
// Uses node:test / node:assert rather than adding a test framework, matching
// how this repo already hand-rolls AES-GCM (lib/encryption.ts) and auth
// (apps/web/lib/auth.ts) instead of pulling in dependencies, and how the
// connector `run.ts` scripts are executed directly by node.
//
// This module gets a test file when nothing else in the repo does because it
// is the one place where being wrong means the agent types a real password
// into an attacker's form. The denial cases below are not hypothetical
// paranoia -- every one of them is a domain an attacker can actually
// register, and each corresponds to a specific way a naive implementation
// of this check fails.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAccountCreationAllowed } from "./account-creation-allowlist.ts";

test("allows real ATS hosts and their tenant subdomains", () => {
  const allowed = [
    "https://boards.greenhouse.io/acme/jobs/123",
    "https://greenhouse.io/signup",
    "https://jobs.lever.co/acme/apply",
    "https://jobs.ashbyhq.com/acme",
    "https://careers.smartrecruiters.com/Acme",
    "https://acme.wd5.myworkdayjobs.com/en-US/careers",
    "https://careers-acme.icims.com/jobs/1/login",
  ];
  for (const url of allowed) {
    assert.equal(checkAccountCreationAllowed(url).allowed, true, url);
  }
});

test("normalizes host case and a trailing root dot", () => {
  // Hostnames are case-insensitive, and "example.com." is the same host as
  // "example.com" -- an attacker shouldn't get a different answer by
  // shouting or by appending the root label.
  assert.equal(checkAccountCreationAllowed("https://BOARDS.GREENHOUSE.IO/x").allowed, true);
  assert.equal(checkAccountCreationAllowed("https://boards.greenhouse.io./x").allowed, true);
});

test("rejects suffix confusion -- the endsWith bug", () => {
  // A bare `hostname.endsWith("greenhouse.io")` accepts both of these.
  // Both are registrable by anyone, today.
  for (const url of ["https://evil-greenhouse.io/login", "https://notlever.co/login"]) {
    const d = checkAccountCreationAllowed(url);
    assert.equal(d.allowed, false, url);
    assert.equal(d.allowed === false && d.reason, "domain_not_allowlisted");
  }
});

test("rejects prefix confusion -- the includes bug", () => {
  // A `hostname.includes("greenhouse.io")` accepts both of these. The real
  // registrable domain is evil.com / attacker.net.
  for (const url of [
    "https://greenhouse.io.evil.com/login",
    "https://boards.greenhouse.io.attacker.net/x",
  ]) {
    const d = checkAccountCreationAllowed(url);
    assert.equal(d.allowed, false, url);
    assert.equal(d.allowed === false && d.reason, "domain_not_allowlisted");
  }
});

test("rejects plaintext HTTP even on an allowlisted domain", () => {
  const d = checkAccountCreationAllowed("http://boards.greenhouse.io/x");
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, "not_https");
});

test("rejects inline credentials in the URL", () => {
  const d = checkAccountCreationAllowed("https://user:pw@boards.greenhouse.io/x");
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, "credentials_in_url");
});

test("rejects raw IP hosts", () => {
  const d = checkAccountCreationAllowed("https://192.168.1.10/signup");
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, "ip_address_host");
});

test("a valid HTTPS site is not sufficient on its own", () => {
  // The whole premise of the module: TLS authenticates the connection, not
  // the operator. This site could have a perfectly valid certificate.
  const d = checkAccountCreationAllowed("https://totally-legit-jobs.com/signup");
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, "domain_not_allowlisted");
});

test("fails closed on unparseable input and non-web schemes", () => {
  assert.equal(checkAccountCreationAllowed("not a url").allowed, false);
  assert.equal(checkAccountCreationAllowed("javascript:alert(1)").allowed, false);
  assert.equal(checkAccountCreationAllowed("data:text/html,<h1>hi").allowed, false);
  assert.equal(checkAccountCreationAllowed("").allowed, false);
});

test("returns the registrable domain, not the full hostname", () => {
  // Storing eTLD+1 is what lets one saved Workday account match every
  // per-employer tenant subdomain.
  const d = checkAccountCreationAllowed("https://acme.wd5.myworkdayjobs.com/en-US/careers");
  assert.equal(d.allowed, true);
  assert.equal(d.allowed === true && d.domain, "myworkdayjobs.com");
  assert.equal(d.allowed === true && d.hostname, "acme.wd5.myworkdayjobs.com");
  assert.equal(d.allowed === true && d.siteName, "Workday");
});
