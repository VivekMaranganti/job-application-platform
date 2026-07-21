import type { Page } from "playwright-core";

// ---------------------------------------------------------------------------
// Scrapes fillable fields out of the current page so the field-matcher
// (agent/field-matcher.ts) has something concrete to reason about. Kept
// intentionally simple (labels + basic input metadata) -- a production
// version would need to handle custom widgets (React-Select-style
// comboboxes, file dropzones, multi-step wizards), which is explicitly out
// of scope for this foundation pass (see README.md "Out of scope").
// ---------------------------------------------------------------------------

export type ExtractedFieldType =
  | "text"
  | "email"
  | "tel"
  | "textarea"
  | "select"
  | "radio-group"
  | "checkbox"
  | "file";

export interface ExtractedField {
  /** Stable-ish CSS selector the agent can use to re-locate this field to fill it. */
  selector: string;
  label: string;
  type: ExtractedFieldType;
  options?: string[];
  required: boolean;
}

export async function extractFormFields(page: Page): Promise<ExtractedField[]> {
  return page.evaluate(() => {
    function labelFor(el: Element): string {
      const id = el.getAttribute("id");
      if (id) {
        const byFor = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (byFor?.textContent?.trim()) return byFor.textContent.trim();
      }
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel?.trim()) return ariaLabel.trim();
      const wrappingLabel = el.closest("label");
      if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim();
      const placeholder = el.getAttribute("placeholder");
      if (placeholder?.trim()) return placeholder.trim();
      const name = el.getAttribute("name");
      return name?.trim() || "(unlabeled field)";
    }

    function selectorFor(el: Element): string {
      const id = el.getAttribute("id");
      if (id) return `#${CSS.escape(id)}`;
      const name = el.getAttribute("name");
      const tag = el.tagName.toLowerCase();
      if (name) return `${tag}[name="${CSS.escape(name)}"]`;
      // Last resort: nth-of-type within the document. Not robust against
      // dynamic re-renders, but good enough for a same-page fill pass.
      const siblings = Array.from(document.querySelectorAll(tag));
      const index = siblings.indexOf(el);
      return `${tag}:nth-of-type(${index + 1})`;
    }

    const results: {
      selector: string;
      label: string;
      type: string;
      options?: string[];
      required: boolean;
    }[] = [];

    const seenRadioGroups = new Set<string>();

    document.querySelectorAll("input, textarea, select").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const inputType = tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : tag;

      if (inputType === "hidden" || inputType === "submit" || inputType === "button") return;

      if (inputType === "radio") {
        const name = el.getAttribute("name");
        if (!name || seenRadioGroups.has(name)) return;
        seenRadioGroups.add(name);
        const group = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
        results.push({
          selector: `input[type="radio"][name="${CSS.escape(name)}"]`,
          label: labelFor(el),
          type: "radio-group",
          options: group.map((r) => labelFor(r)),
          required: group.some((r) => r.hasAttribute("required")),
        });
        return;
      }

      const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true";

      if (tag === "select") {
        const options = Array.from(el.querySelectorAll("option"))
          .map((o) => o.textContent?.trim() || "")
          .filter(Boolean);
        results.push({ selector: selectorFor(el), label: labelFor(el), type: "select", options, required });
        return;
      }

      if (tag === "textarea") {
        results.push({ selector: selectorFor(el), label: labelFor(el), type: "textarea", required });
        return;
      }

      if (inputType === "checkbox") {
        results.push({ selector: selectorFor(el), label: labelFor(el), type: "checkbox", required });
        return;
      }

      if (inputType === "file") {
        results.push({ selector: selectorFor(el), label: labelFor(el), type: "file", required });
        return;
      }

      const type: string = inputType === "email" || inputType === "tel" ? inputType : "text";
      results.push({ selector: selectorFor(el), label: labelFor(el), type, required });
    });

    return results;
  }) as Promise<ExtractedField[]>;
}

/**
 * Heuristic CAPTCHA detection: known widget hostnames/frame patterns.
 * Real CAPTCHAs vary a lot; this catches the common providers
 * (reCAPTCHA, hCaptcha, Cloudflare Turnstile) and is deliberately a
 * yield-control trigger rather than something the agent ever attempts to
 * solve -- see agent/field-matcher.ts and README.md.
 */
export async function detectCaptcha(page: Page): Promise<boolean> {
  const frameUrls = page.frames().map((f) => f.url());
  const patterns = [/recaptcha/i, /hcaptcha/i, /turnstile/i, /captcha/i];
  return frameUrls.some((url) => patterns.some((p) => p.test(url)));
}

// ---------------------------------------------------------------------------
// Registration / login wall detection.
//
// Several ATSs (Workday and iCIMS most consistently) won't render the
// application form until the candidate has an account. The automation loop
// needs to notice that it's looking at an auth form rather than the
// application, because filling an application-shaped matcher's decisions
// into a signup form would be both useless and, for the password field,
// actively bad.
// ---------------------------------------------------------------------------

export interface AuthWall {
  /**
   * "signup" when the page is asking to create an account, "login" when it's
   * asking to sign in to an existing one. The distinction decides whether
   * the agent generates a new credential or looks one up.
   */
  kind: "signup" | "login";
  /** Selector for the password input. */
  passwordSelector: string;
  /** Selector for a "confirm password" input, when the form has one. */
  confirmPasswordSelector?: string;
  /** Selector for the username/email input, if one was found. */
  usernameSelector?: string;
  /** Selector for the form's submit control, if one was found. */
  submitSelector?: string;
  /**
   * Fields on the auth form that aren't username/password/confirm -- e.g.
   * "First name", security questions, a country dropdown. The provisioner
   * yields to the human rather than guessing at these.
   */
  extraFieldSelectors: string[];
}

/**
 * Raw evidence scraped from the page, before any signup-vs-login judgement.
 *
 * The scraping and the judgement are split so the judgement can be tested.
 * Everything inside `page.evaluate` runs in the browser and is serialized
 * across the CDP boundary, which makes it effectively untestable without a
 * live browser -- so `page.evaluate` collects facts only, and
 * `classifyAuthWall` below turns them into a decision in Node, where a unit
 * test can reach it.
 */
export interface AuthWallSignals {
  passwordCount: number;
  /** A password input whose attributes say "confirm"/"repeat"/"retype". */
  hasExplicitConfirmField: boolean;
  /** Any password input declaring `autocomplete="new-password"`. */
  declaresNewPassword: boolean;
  /** Leading slice of visible page text, lowercased. */
  bodyTextSample: string;
  passwordSelector: string;
  confirmPasswordSelector?: string;
  usernameSelector?: string;
  submitSelector?: string;
  extraFieldSelectors: string[];
}

const SIGNUP_PHRASES = /create (an )?account|sign up|register|new user|create profile|join now/;
const LOGIN_PHRASES = /sign in|log in|login|welcome back|forgot password/;

/**
 * Turns scraped signals into a signup/login call.
 *
 * A password input is necessary evidence: no password field means this isn't
 * an auth form, whatever the prose says (job descriptions say "sign in to
 * apply" all the time without being a login form).
 *
 * Ambiguity resolves to "login", deliberately. Guessing "signup" on a login
 * page means the agent tries to register an account that already exists and
 * fails noisily. Guessing "login" on a signup page means it looks for a
 * saved credential, doesn't find one, and asks the human -- the cheaper
 * mistake. The outcome worth avoiding is a *second* account on an ATS the
 * user already has one for, which silently splits their application history
 * across two logins and is invisible until they go looking for a submission
 * that isn't there.
 *
 * Structural signals (a confirm-password field, `autocomplete="new-password"`)
 * outrank prose, because a page can say "sign in" in a header link while the
 * form itself is a registration form.
 */
export function classifyAuthWall(signals: AuthWallSignals | null): AuthWall | null {
  if (!signals || signals.passwordCount === 0) return null;

  const structurallySignup =
    signals.hasExplicitConfirmField || signals.passwordCount > 1 || signals.declaresNewPassword;

  const text = signals.bodyTextSample;
  const kind: "signup" | "login" = structurallySignup
    ? "signup"
    : SIGNUP_PHRASES.test(text) && !LOGIN_PHRASES.test(text)
      ? "signup"
      : "login";

  return {
    kind,
    passwordSelector: signals.passwordSelector,
    confirmPasswordSelector: signals.confirmPasswordSelector,
    usernameSelector: signals.usernameSelector,
    submitSelector: signals.submitSelector,
    extraFieldSelectors: signals.extraFieldSelectors,
  };
}

/**
 * Scrapes auth-form evidence off the current page. Returns null when there
 * is no password input at all.
 */
export async function extractAuthWallSignals(page: Page): Promise<AuthWallSignals | null> {
  return page.evaluate(() => {
    function selectorFor(el: Element): string {
      const id = el.getAttribute("id");
      if (id) return `#${CSS.escape(id)}`;
      const name = el.getAttribute("name");
      const tag = el.tagName.toLowerCase();
      if (name) return `${tag}[name="${CSS.escape(name)}"]`;
      const siblings = Array.from(document.querySelectorAll(tag));
      return `${tag}:nth-of-type(${siblings.indexOf(el) + 1})`;
    }

    function describe(el: Element): string {
      return [
        el.getAttribute("id"),
        el.getAttribute("name"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.getAttribute("autocomplete"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    }

    const passwords = Array.from(
      document.querySelectorAll('input[type="password"]'),
    ) as HTMLInputElement[];
    if (passwords.length === 0) return null;

    const confirmIndex = passwords.findIndex((el) =>
      /confirm|repeat|retype|verify|again/.test(describe(el)),
    );
    const primaryPassword = passwords[confirmIndex === 0 ? 1 : 0] ?? passwords[0]!;
    const confirmPassword =
      confirmIndex !== -1 ? passwords[confirmIndex] : passwords.length > 1 ? passwords[1] : undefined;

    const usernameEl = (
      Array.from(
        document.querySelectorAll('input[type="email"], input[type="text"], input:not([type])'),
      ) as HTMLInputElement[]
    ).find((el) => {
      const d = describe(el);
      return /email|user ?name|userid|user_id|login/.test(d) || el.type === "email";
    });

    const submitEl =
      document.querySelector('button[type="submit"], input[type="submit"]') ??
      (Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]).find((b) =>
        /sign in|log ?in|create account|sign up|register|continue|submit/i.test(b.innerText || ""),
      );

    const known = new Set<Element>([primaryPassword, ...(confirmPassword ? [confirmPassword] : [])]);
    if (usernameEl) known.add(usernameEl);
    const extraFieldSelectors = (
      Array.from(document.querySelectorAll("input, select, textarea")) as HTMLElement[]
    )
      .filter((el) => {
        if (known.has(el)) return false;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (["hidden", "submit", "button", "checkbox", "image", "reset"].includes(type)) return false;
        return (el as HTMLInputElement).offsetParent !== null;
      })
      .map(selectorFor);

    return {
      passwordCount: passwords.length,
      hasExplicitConfirmField: confirmIndex !== -1,
      declaresNewPassword: passwords.some((el) =>
        (el.getAttribute("autocomplete") || "").toLowerCase().includes("new-password"),
      ),
      bodyTextSample: (document.body.innerText || "").toLowerCase().slice(0, 5000),
      passwordSelector: selectorFor(primaryPassword),
      confirmPasswordSelector: confirmPassword ? selectorFor(confirmPassword) : undefined,
      usernameSelector: usernameEl ? selectorFor(usernameEl) : undefined,
      submitSelector: submitEl ? selectorFor(submitEl) : undefined,
      extraFieldSelectors,
    };
  }) as Promise<AuthWallSignals | null>;
}

/** Detects whether the current page is an auth wall, and which kind. */
export async function detectAuthWall(page: Page): Promise<AuthWall | null> {
  return classifyAuthWall(await extractAuthWallSignals(page));
}
