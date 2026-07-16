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
