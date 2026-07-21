import type { Page } from "playwright-core";
import {
  checkAccountCreationAllowed,
  findCredentialForUrl,
  saveCredential,
  generatePassword,
} from "auto-job-applier-db";
import type { SessionControl } from "./types";
import type { ApplicationContext } from "../db/context";
import { detectAuthWall, type AuthWall } from "../browser/dom-extraction";

// ---------------------------------------------------------------------------
// Getting past a registration wall.
//
// Workday and iCIMS in particular won't render the application form until
// the candidate has an account. This module is the only place in the service
// that creates one or types a stored password into a page.
//
// ## Relationship to the never-auto-submit invariant
//
// This module submits a form. That deserves to be spelled out, because it
// sits next to an invariant that says the agent never submits anything.
//
// The invariant is specifically that the agent never submits *the job
// application* -- the irreversible, human-visible act of applying on
// someone's behalf. Submitting a signup form is a different act with a
// different risk profile: it creates an account the user can delete, it puts
// no application in front of an employer, and requiring a human click for it
// would defeat the entire point of automating the application.
//
// The separation is kept structural rather than trusted to this comment:
//
//   - This module submits by calling `submitAuthForm` below, which clicks a
//     selector that came out of `detectAuthWall` -- a function that only
//     returns anything when the page has a password input. On a page with no
//     password field, `provisionAccountIfNeeded` returns "not_an_auth_wall"
//     before reaching any click.
//   - It never calls `page.click` on an arbitrary or caller-supplied
//     selector, so it cannot be pointed at an application form's submit
//     button by a future caller passing different arguments.
//   - It cannot mark an Application submitted regardless: `markSubmitted`
//     (db/status.ts) only writes SUBMITTED over a row that is currently
//     READY_FOR_REVIEW, and only `ApplySession.confirmSubmit` calls it. This
//     module holds a `SessionControl`, which has no submit method at all.
//
// ## What it will not do
//
// Register anywhere that isn't on the ATS allowlist, including when a
// credential for a lookalike domain would otherwise match. Invent answers to
// signup fields beyond username and password. Solve a CAPTCHA. Each of those
// yields to the human instead.
// ---------------------------------------------------------------------------

export type ProvisionOutcome =
  /** No password field on the page -- this isn't an auth wall, carry on. */
  | { kind: "not_an_auth_wall" }
  /** Signed in with a credential already in the vault. */
  | { kind: "signed_in"; username: string }
  /** Registered a new account and saved it to the vault. */
  | { kind: "created_account"; username: string }
  /**
   * The agent stopped and handed the human the wheel. The automation loop
   * should re-extract the page afterward rather than assume anything about
   * what the human did.
   */
  | { kind: "yielded_to_human"; reason: string };

/**
 * The username the agent registers with.
 *
 * Prefers the profile's contact email over the login email, because the
 * contact email is the address the user has already said they want employers
 * using -- and ATS account email is what employers reply to. Falls back to
 * the account email when no contact email is set.
 */
function usernameFor(context: ApplicationContext): string {
  const username = context.profile.contactEmail?.trim() || context.accountEmail.trim();
  if (!username) {
    throw new Error("No email address on file to register an ATS account with.");
  }
  return username;
}

/**
 * Inspects the current page and, if it's an auth wall, gets past it.
 *
 * Returns without acting when the page isn't an auth wall, so the automation
 * loop can call this at the top of every pass without needing to know
 * anything about registration itself.
 */
export async function provisionAccountIfNeeded(
  control: SessionControl,
  page: Page,
  context: ApplicationContext,
): Promise<ProvisionOutcome> {
  const wall = await detectAuthWall(page);
  if (!wall) return { kind: "not_an_auth_wall" };

  const url = page.url();
  const decision = checkAccountCreationAllowed(url);

  if (!decision.allowed) {
    // Note this refuses to *sign in* here too, not just to register. If the
    // host isn't allowlisted, typing a stored password into it is the
    // credential-phishing outcome the allowlist exists to prevent -- a
    // lookalike page's whole goal is to be handed an existing password.
    await control.yieldControl(
      "account_creation_not_allowed",
      undefined,
      "account_credentials",
      `This page is asking for an account, but ${safeHost(url)} isn't a recognized ATS. ` +
        `${decision.detail} Nothing has been typed. If you trust this site, sign in or ` +
        `register yourself and hand control back.`,
    );
    return { kind: "yielded_to_human", reason: "account_creation_not_allowed" };
  }

  // Reuse before create, for both wall kinds. A saved Workday credential is
  // valid across every employer tenant on that domain, so hitting a fresh
  // employer's signup page is not a reason to make a second account.
  const existing = await findCredentialForUrl(context.userId, url);

  if (existing) {
    try {
      await fillAuthForm(page, wall, existing.credential.username, existing.password, {
        includeConfirm: false,
      });
      await submitAuthForm(page, wall);
      await control.recordAccountAction("signed_in", decision.hostname, existing.credential.username);
      return { kind: "signed_in", username: existing.credential.username };
    } catch (err) {
      await control.yieldControl(
        "account_creation_failed",
        undefined,
        "account_credentials",
        `Couldn't sign in to ${decision.siteName} with the saved account ` +
          `(${existing.credential.username}): ${messageOf(err, existing.password)}. ` +
          `The password may have changed. ` +
          `Sign in manually and hand control back.`,
      );
      return { kind: "yielded_to_human", reason: "sign_in_failed" };
    }
  }

  // No stored credential. On a login page that means the user has an account
  // we don't know about, or doesn't have one and the site wants a different
  // page -- either way, registering here would be wrong.
  if (wall.kind === "login") {
    await control.yieldControl(
      "account_form_needs_input",
      undefined,
      "account_credentials",
      `${decision.siteName} is asking you to sign in, and there's no saved account for ` +
        `${decision.domain}. Sign in manually and hand control back -- then save the ` +
        `credentials under Accounts so this is automatic next time.`,
    );
    return { kind: "yielded_to_human", reason: "no_saved_credential_for_login" };
  }

  // A signup form asking for more than username + password. Guessing at
  // "Country" or a security question produces a real account with wrong data
  // attached, which is worse than stopping.
  if (wall.extraFieldSelectors.length > 0) {
    await control.yieldControl(
      "account_form_needs_input",
      undefined,
      "account_credentials",
      `${decision.siteName} wants ${wall.extraFieldSelectors.length} extra field(s) to register ` +
        `beyond email and password. Fill those in yourself and hand control back -- ` +
        `I won't guess at them.`,
    );
    return { kind: "yielded_to_human", reason: "signup_form_has_extra_fields" };
  }

  const username = usernameFor(context);
  const password = generatePassword();

  // Saved BEFORE submitting the form. If the order were reversed, a signup
  // that succeeded server-side but crashed the browser before the save would
  // leave a real account whose password exists nowhere -- unrecoverable
  // except by a password reset. Saving first means the worst case is a vault
  // row for an account that doesn't exist, which is inert and easy to delete.
  const saved = await saveCredential({
    userId: context.userId,
    url,
    username,
    password,
    createdByAgent: true,
  });
  if (!saved.ok) {
    await control.yieldControl(
      "account_creation_not_allowed",
      undefined,
      "account_credentials",
      `Refused to store credentials for this site: ${saved.decision.detail}`,
    );
    return { kind: "yielded_to_human", reason: saved.decision.reason };
  }

  try {
    await fillAuthForm(page, wall, username, password, { includeConfirm: true });
    await submitAuthForm(page, wall);
  } catch (err) {
    await control.yieldControl(
      "account_creation_failed",
      undefined,
      "account_credentials",
      `Couldn't complete registration on ${decision.siteName}: ${messageOf(err, password)}. ` +
        `The generated password is saved under Accounts -- either finish the signup ` +
        `manually with it, or delete that entry.`,
    );
    return { kind: "yielded_to_human", reason: "registration_failed" };
  }

  await control.recordAccountAction("created_account", decision.hostname, username);
  return { kind: "created_account", username };
}

/**
 * Types the credential into the detected auth form.
 *
 * Deliberately not routed through browser/field-actions.ts's
 * `applyFieldValue`: that path is driven by the field-matcher's decisions and
 * feeds the ApplicationLogEntry trail for application fields. Passwords have
 * no business flowing through the same code as application answers, and the
 * separation means no future change to the field-matcher can start routing a
 * password anywhere.
 */
async function fillAuthForm(
  page: Page,
  wall: AuthWall,
  username: string,
  password: string,
  opts: { includeConfirm: boolean },
): Promise<void> {
  if (wall.usernameSelector) {
    await page.locator(wall.usernameSelector).first().fill(username);
  }
  await page.locator(wall.passwordSelector).first().fill(password);
  if (opts.includeConfirm && wall.confirmPasswordSelector) {
    await page.locator(wall.confirmPasswordSelector).first().fill(password);
  }
}

/**
 * Submits the auth form.
 *
 * Only ever clicks `wall.submitSelector` -- a selector produced by
 * `detectAuthWall`, which returns null unless the page has a password input.
 * It takes no caller-supplied selector, which is what stops this from being
 * reusable as a general-purpose "click submit" on an application form.
 * Falling back to pressing Enter in the password field keeps that property:
 * it acts on the auth form's own input, not on an arbitrary element.
 */
async function submitAuthForm(page: Page, wall: AuthWall): Promise<void> {
  if (wall.submitSelector) {
    await page.locator(wall.submitSelector).first().click();
  } else {
    await page.locator(wall.passwordSelector).first().press("Enter");
  }
  // Registration usually navigates. Waiting for network idle rather than a
  // fixed sleep, with a bounded timeout so a page that keeps a socket open
  // (common with analytics) doesn't hang the session.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Error text, with the password scrubbed out.
 *
 * These messages go into `yield_control`, which is broadcast to the human's
 * browser and is the one category of event this codebase treats as safe to
 * log and persist. Playwright's own errors quote the selector and the action
 * rather than the value, so this shouldn't be reachable today -- but "an
 * exception message from a third-party library never contains the string we
 * just typed into the page" is an assumption about someone else's code that
 * would break silently and in the worst possible direction.
 *
 * Substring replacement rather than anything cleverer, because the generated
 * password is a known exact string at every call site.
 */
function messageOf(err: unknown, secret?: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (!secret) return raw;
  return raw.split(secret).join("[redacted]");
}
