import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import type { FieldValueCategory } from "../protocol/events";
import type { ExtractedField } from "../browser/dom-extraction";

// ---------------------------------------------------------------------------
// Open decision 2 (see README.md): which LLM powers in-session field-filling
// decisions. `@anthropic-ai/sdk` is already a dependency of apps/web (used
// for resume/title derivation -- see apps/web/lib/title-derivation.ts), and
// this mirrors that exact pattern: a lazily-constructed client that throws a
// clear, typed "not configured" error if ANTHROPIC_API_KEY is missing,
// rather than a cryptic SDK failure deep in a session.
//
// PRIVACY NOTE: this module is only ever asked to *classify* a field's
// label/type/options into our closed FieldValueCategory taxonomy -- it is
// never given a required-info answer's actual value (work authorization,
// veteran/disability status, race, gender, security clearance, criminal
// history). Those sensitive values are matched against a field's options
// deterministically in field-matcher.ts, entirely in-process, after
// classification -- they never enter a prompt sent to a third-party model.
// See field-matcher.ts's file header for the full rationale.
// ---------------------------------------------------------------------------

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("Field-matching LLM is not configured (ANTHROPIC_API_KEY is not set on the server).");
    this.name = "LlmNotConfiguredError";
  }
}

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LlmNotConfiguredError();
  }
  return new Anthropic();
}

export interface FieldClassification {
  index: number;
  category: FieldValueCategory;
  /** 0-1, the model's self-reported confidence. Clamped defensively on parse. */
  confidence: number;
}

const KNOWN_CATEGORIES: FieldValueCategory[] = [
  "work_auth",
  "sponsorship",
  "veteran",
  "disability",
  "race_ethnicity",
  "gender",
  "security_clearance",
  "criminal_history",
  "full_name",
  "email",
  "phone",
  "location",
  "resume_upload",
  "cover_letter",
  "linkedin_url",
  "portfolio_url",
  "work_history",
  "education",
  "other",
];

function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function coerceCategory(value: unknown): FieldValueCategory {
  return typeof value === "string" && (KNOWN_CATEGORIES as string[]).includes(value)
    ? (value as FieldValueCategory)
    : "other";
}

/**
 * Classifies a batch of not-yet-recognized fields (see field-matcher.ts's
 * deterministic keyword pass, which runs first and only escalates leftovers
 * here) into the closed FieldValueCategory taxonomy. Sends only label/type/
 * options -- never a stored answer value.
 */
export async function classifyFields(
  fields: { index: number; label: string; type: string; options?: string[] }[],
): Promise<FieldClassification[]> {
  if (fields.length === 0) return [];

  const client = getClient();
  const prompt =
    "You are classifying job-application form fields into a fixed set of categories for an " +
    "automated form-filling assistant. For each field below, pick the single best-matching category " +
    `from this exact list: ${KNOWN_CATEGORIES.join(", ")}. ` +
    "Use \"other\" if nothing fits well. Respond with ONLY raw JSON (no markdown fences, no prose) as an array: " +
    '[{"index": <number>, "category": "<one of the list above>", "confidence": <0 to 1>}, ...] ' +
    "with exactly one entry per field, in any order. Fields:\n\n" +
    JSON.stringify(fields, null, 2);

  const response = await client.messages.create({
    model: config.fieldMatcherModel,
    max_tokens: 2000,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let parsed: unknown;
  try {
    parsed = parseJsonLoose(text);
  } catch {
    // Malformed response -- treat every field as unrecognized rather than
    // throwing, so the session degrades to "yield to human" instead of
    // crashing. See field-matcher.ts's "unrecognized_field" yield reason.
    return fields.map((f) => ({ index: f.index, category: "other", confidence: 0 }));
  }

  if (!Array.isArray(parsed)) {
    return fields.map((f) => ({ index: f.index, category: "other", confidence: 0 }));
  }

  const byIndex = new Map<number, FieldClassification>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const index = typeof e.index === "number" ? e.index : Number(e.index);
    if (!Number.isFinite(index)) continue;
    byIndex.set(index, {
      index,
      category: coerceCategory(e.category),
      confidence: clampConfidence(e.confidence),
    });
  }

  return fields.map((f) => byIndex.get(f.index) ?? { index: f.index, category: "other", confidence: 0 });
}

/** Re-exported for field-matcher.ts's type annotations. */
export type { ExtractedField };
