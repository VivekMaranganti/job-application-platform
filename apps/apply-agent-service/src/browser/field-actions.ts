import type { Page } from "playwright-core";
import type { ExtractedField } from "./dom-extraction";

// ---------------------------------------------------------------------------
// Physically applies a decided value to a page field. Kept separate from
// dom-extraction.ts/field-matcher.ts so the "what to fill" decision and the
// "how to fill it" mechanics are independently testable.
//
// Best-effort implementation covering the common field shapes -- custom
// widgets (React-Select-style comboboxes, rich text editors, date pickers)
// are not handled and will generally fail the corresponding Playwright
// action, surfacing as a session error the human sees via a `yield_control`
// (see session/automation-loop.ts's try/catch around this call). Out of
// scope for this foundation pass -- see README.md.
// ---------------------------------------------------------------------------

export async function fillTextLikeField(page: Page, field: ExtractedField, value: string): Promise<void> {
  await page.locator(field.selector).first().fill(value);
}

export async function selectDropdownOption(page: Page, field: ExtractedField, optionLabel: string): Promise<void> {
  const locator = page.locator(field.selector).first();
  try {
    await locator.selectOption({ label: optionLabel });
  } catch {
    await locator.selectOption(optionLabel);
  }
}

export async function selectRadioOption(page: Page, field: ExtractedField, optionLabel: string): Promise<void> {
  // field.selector is the shared `input[type="radio"][name="..."]` selector
  // for the whole group (see dom-extraction.ts). Find the specific radio
  // whose associated label text matches.
  const radios = page.locator(field.selector);
  const count = await radios.count();
  for (let i = 0; i < count; i++) {
    const radio = radios.nth(i);
    const labelText = await radio.evaluate((el) => {
      const id = el.getAttribute("id");
      if (id) {
        const byFor = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (byFor?.textContent?.trim()) return byFor.textContent.trim();
      }
      return el.closest("label")?.textContent?.trim() ?? el.getAttribute("value") ?? "";
    });
    if (labelText.trim().toLowerCase() === optionLabel.trim().toLowerCase()) {
      await radio.check();
      return;
    }
  }
  throw new Error(`Could not find a radio option matching "${optionLabel}" for "${field.label}".`);
}

export async function setCheckbox(page: Page, field: ExtractedField, checked: boolean): Promise<void> {
  const locator = page.locator(field.selector).first();
  if (checked) await locator.check();
  else await locator.uncheck();
}

export async function uploadFile(
  page: Page,
  field: ExtractedField,
  file: { fileName: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.locator(field.selector).first().setInputFiles({
    name: file.fileName,
    mimeType: file.mimeType,
    buffer: file.buffer,
  });
}

/** Applies `value` to `field` using the action appropriate to its type. */
export async function applyFieldValue(page: Page, field: ExtractedField, value: string): Promise<void> {
  switch (field.type) {
    case "select":
      return selectDropdownOption(page, field, value);
    case "radio-group":
      return selectRadioOption(page, field, value);
    case "checkbox":
      return setCheckbox(page, field, /^(yes|true|y)$/i.test(value));
    case "file":
      throw new Error("File fields must be filled via uploadFile(), not applyFieldValue().");
    default:
      return fillTextLikeField(page, field, value);
  }
}
