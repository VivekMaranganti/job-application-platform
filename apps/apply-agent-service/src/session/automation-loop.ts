import type { Page } from "playwright-core";
import type { SessionControl } from "./types";
import type { ApplicationContext } from "../db/context";
import type { ReviewSummaryItem, FieldValueCategory } from "../protocol/events";
import { extractFormFields, detectCaptcha } from "../browser/dom-extraction";
import { matchFields, type FieldDecision } from "../agent/field-matcher";
import { applyFieldValue, uploadFile } from "../browser/field-actions";
import { getResumeFileForUpload } from "../agent/resume-content";

// ---------------------------------------------------------------------------
// The core fill loop. Takes `SessionControl` -- NOT the full `ApplySession`
// -- so it structurally cannot submit anything (see session/types.ts's file
// header for why that's a compile-time guarantee, not a convention).
//
// Termination is intentionally simple (a small fixed number of
// extract-decide-fill passes, to catch conditional fields revealed by an
// earlier answer) rather than a fully general fixed-point/mutation-observer
// approach -- see README.md "Out of scope" for what a production version
// would need on top of this foundation.
// ---------------------------------------------------------------------------

const MAX_PASSES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWhileHumanDriving(control: SessionControl): Promise<void> {
  while (control.isHumanDriving()) {
    await sleep(200);
  }
}

export async function runAutomationLoop(
  control: SessionControl,
  page: Page,
  context: ApplicationContext,
): Promise<ReviewSummaryItem[]> {
  await control.advanceStatus("in_progress");
  await page.goto(context.jobListing.url, { waitUntil: "domcontentloaded" });

  const summaryBySelector = new Map<string, ReviewSummaryItem>();
  let needsAnotherPass = true;
  let pass = 0;

  while (needsAnotherPass && pass < MAX_PASSES) {
    pass += 1;
    needsAnotherPass = false;
    await waitWhileHumanDriving(control);

    if (await detectCaptcha(page)) {
      const resolution = await control.yieldControl(
        "captcha",
        undefined,
        undefined,
        "A CAPTCHA was detected. Please solve it in the live session, then hand control back.",
      );
      // Whatever the human did (handback, or a field_input that doesn't
      // really apply here), re-run this pass from the top -- we don't know
      // the CAPTCHA state without re-checking.
      void resolution;
      pass -= 1;
      continue;
    }

    const fields = await extractFormFields(page);
    const decisions: FieldDecision[] = await matchFields(fields, context);

    for (const decision of decisions) {
      await waitWhileHumanDriving(control);
      const fieldRef = { label: decision.field.label, selector: decision.field.selector };

      try {
        if (decision.kind === "fill") {
          await applyFieldValue(page, decision.field, decision.value);
          await control.recordAutoFill(fieldRef, decision.valueCategory, decision.confidence);
          summaryBySelector.set(fieldRef.selector, { field: fieldRef, valueCategory: decision.valueCategory, source: "auto" });
          continue;
        }

        if (decision.kind === "fill-file") {
          const resumeFile = await getResumeFileForUpload(context.userId);
          if (!resumeFile) {
            const resolution = await control.requestUserInput(
              fieldRef,
              "No resume is on file to upload -- please upload one directly, or provide a file.",
            );
            await handleResolution(control, page, decision.field, "resume_upload", resolution, summaryBySelector);
            needsAnotherPass = needsAnotherPass || resolution.kind === "handback";
            continue;
          }
          await uploadFile(page, decision.field, resumeFile);
          await control.recordAutoFill(fieldRef, "resume_upload", decision.confidence);
          summaryBySelector.set(fieldRef.selector, { field: fieldRef, valueCategory: "resume_upload", source: "auto" });
          continue;
        }

        // decision.kind === "yield"
        const resolution =
          decision.reason === "unrecognized_field"
            ? await control.requestUserInput(fieldRef, decision.message)
            : await control.yieldControl(decision.reason, fieldRef, decision.valueCategory, decision.message);

        const resolved = await handleResolution(control, page, decision.field, decision.valueCategory, resolution, summaryBySelector);
        if (resolution.kind === "handback") needsAnotherPass = true;
        void resolved;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await control.yieldControl("error", fieldRef, decision.kind === "yield" ? decision.valueCategory : undefined, `Couldn't apply "${fieldRef.label}": ${message}`);
      }
    }
  }

  const summary = Array.from(summaryBySelector.values());
  await control.requestReview(summary);
  return summary;
}

async function handleResolution(
  control: SessionControl,
  page: Page,
  field: Parameters<typeof applyFieldValue>[1],
  category: FieldValueCategory | undefined,
  resolution: Awaited<ReturnType<SessionControl["requestUserInput"]>>,
  summaryBySelector: Map<string, ReviewSummaryItem>,
): Promise<boolean> {
  const fieldRef = { label: field.label, selector: field.selector };
  if (resolution.kind === "field_input") {
    const resolvedCategory = category ?? "other";
    await applyFieldValue(page, field, resolution.value);
    await control.recordHumanFill(fieldRef, resolvedCategory);
    summaryBySelector.set(fieldRef.selector, { field: fieldRef, valueCategory: resolvedCategory, source: "user-provided-live" });
    return true;
  }
  if (resolution.kind === "skip") {
    // Explicitly skipped by the human -- nothing was sent, so nothing is logged.
    return true;
  }
  // "handback": the human drove the browser directly. We don't know what
  // (if anything) changed for this specific field -- the next pass's
  // re-extraction is what picks that up.
  return false;
}
