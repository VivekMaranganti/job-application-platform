import { isCriminalHistoryAutoModeAllowed } from "auto-job-applier-db";
import type { ExtractedField } from "../browser/dom-extraction";
import type { ApplicationContext, RequiredInfoAnswerContext } from "../db/context";
import type { FieldValueCategory } from "../protocol/events";
import { classifyFields } from "./llm-client";
import { parseJurisdiction } from "./jurisdiction";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Decides, for every field scraped off the page, whether the agent may fill
// it itself or must yield control to the human -- the turn-taking core of
// the apply agent.
//
// PRIVACY: required-info categories (work_auth, sponsorship, veteran,
// disability, race_ethnicity, gender, security_clearance, criminal_history)
// are matched to the field's own on-page options *deterministically*
// (case-insensitive substring matching, in-process) -- the stored answer
// value is never sent to the LLM. The LLM (agent/llm-client.ts) only ever
// sees a field's label/type/options, used to classify it into a category;
// substituting the real value happens here, after classification, without
// another model round-trip.
//
// Manual-mode required-info fields ALWAYS yield, regardless of confidence
// (per the RequiredInfoAnswer.mode contract in apps/web/lib/types.ts /
// packages/db/prisma/schema.prisma) -- see the `mode === "manual"` check
// below, which runs before any confidence check.
// ---------------------------------------------------------------------------

const REQUIRED_INFO_CATEGORIES: FieldValueCategory[] = [
  "work_auth",
  "sponsorship",
  "veteran",
  "disability",
  "race_ethnicity",
  "gender",
  "security_clearance",
  "criminal_history",
];

function isRequiredInfoCategory(category: FieldValueCategory): boolean {
  return (REQUIRED_INFO_CATEGORIES as string[]).includes(category);
}

/** Fast deterministic keyword pass, tried before ever calling the LLM. */
const KEYWORD_RULES: { pattern: RegExp; category: FieldValueCategory }[] = [
  { pattern: /work(ing)?\s*authoriz|legally\s*authorized|eligib(le|ility).*work/i, category: "work_auth" },
  { pattern: /sponsor(ship)?/i, category: "sponsorship" },
  { pattern: /veteran/i, category: "veteran" },
  { pattern: /disab(led|ility)/i, category: "disability" },
  { pattern: /race|ethnicit/i, category: "race_ethnicity" },
  { pattern: /gender|\bsex\b/i, category: "gender" },
  { pattern: /security\s*clearance|clearance\s*level/i, category: "security_clearance" },
  { pattern: /criminal|conviction|felony/i, category: "criminal_history" },
  { pattern: /^full\s*name$|^name$|first\s*name.*last\s*name|your\s*name/i, category: "full_name" },
  { pattern: /e-?mail/i, category: "email" },
  { pattern: /phone|mobile|telephone/i, category: "phone" },
  { pattern: /city|location|address|where.*located/i, category: "location" },
  { pattern: /resum(e|é)|\bcv\b/i, category: "resume_upload" },
  { pattern: /cover\s*letter/i, category: "cover_letter" },
  { pattern: /linkedin/i, category: "linkedin_url" },
  { pattern: /portfolio|website|github/i, category: "portfolio_url" },
];

function deterministicCategory(field: ExtractedField): FieldValueCategory | undefined {
  if (field.type === "file") return "resume_upload";
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(field.label)) return rule.category;
  }
  return undefined;
}

export type FieldDecision =
  | {
      kind: "fill";
      field: ExtractedField;
      valueCategory: FieldValueCategory;
      value: string;
      confidence: number;
    }
  | {
      kind: "fill-file";
      field: ExtractedField;
      valueCategory: "resume_upload";
      confidence: number;
    }
  | {
      kind: "yield";
      field: ExtractedField;
      valueCategory?: FieldValueCategory;
      reason: "manual_field" | "low_confidence" | "unrecognized_field" | "jurisdiction_not_cleared";
      message: string;
    };

function findRequiredAnswer(
  context: ApplicationContext,
  category: FieldValueCategory,
): RequiredInfoAnswerContext | undefined {
  return context.requiredInfoAnswers.find((a) => a.fieldId === category);
}

/** Case-insensitive substring match of a stored answer against a field's own options. */
function matchOption(value: string, options: string[] | undefined): string | undefined {
  if (!options || options.length === 0) return value;
  const normalized = value.trim().toLowerCase();
  const exact = options.find((o) => o.trim().toLowerCase() === normalized);
  if (exact) return exact;
  const substring = options.find(
    (o) => o.trim().toLowerCase().includes(normalized) || normalized.includes(o.trim().toLowerCase()),
  );
  return substring;
}

function decideRequiredInfoField(
  field: ExtractedField,
  category: FieldValueCategory,
  confidence: number,
  context: ApplicationContext,
): FieldDecision {
  const answer = findRequiredAnswer(context, category);
  if (!answer) {
    return {
      kind: "yield",
      field,
      valueCategory: category,
      reason: "unrecognized_field",
      message: `No stored answer for "${category}" -- ask the human to fill "${field.label}".`,
    };
  }
  // Structural rule: manual mode ALWAYS yields, before any confidence check.
  if (answer.mode === "manual") {
    return {
      kind: "yield",
      field,
      valueCategory: category,
      reason: "manual_field",
      message: `"${field.label}" is configured as manual-entry -- waiting for the human to answer live.`,
    };
  }
  // Defense-in-depth (issue #7): criminal_history should never reach here
  // with mode="auto" today -- apps/web's saveRequiredInfoAnswer
  // unconditionally downgrades it to "manual" at save time. This check
  // exists in case that upstream gate is ever bypassed (raw DB write,
  // migration script, future code change) -- it fails closed independent of
  // whether the mode gate held. See packages/db/lib/policy/README.md.
  if (category === "criminal_history" && !isCriminalHistoryAutoModeAllowed(parseJurisdiction(context.jobListing.location))) {
    return {
      kind: "yield",
      field,
      valueCategory: category,
      reason: "jurisdiction_not_cleared",
      message: `"${field.label}" (criminal history) has not been cleared for auto-fill in this job's jurisdiction -- waiting for the human to answer live.`,
    };
  }
  if (confidence < config.minAutoFillConfidence) {
    return {
      kind: "yield",
      field,
      valueCategory: category,
      reason: "low_confidence",
      message: `Low-confidence match (${confidence.toFixed(2)}) for "${field.label}" -- deferring to the human.`,
    };
  }
  if (answer.value === null) {
    return {
      kind: "yield",
      field,
      valueCategory: category,
      reason: "unrecognized_field",
      message: `Stored answer for "${category}" is unavailable -- ask the human to fill "${field.label}".`,
    };
  }
  const matched = matchOption(answer.value, field.options);
  if (!matched) {
    return {
      kind: "yield",
      field,
      valueCategory: category,
      reason: "low_confidence",
      message: `Couldn't map the stored answer to any option on "${field.label}" -- deferring to the human.`,
    };
  }
  return { kind: "fill", field, valueCategory: category, value: matched, confidence };
}

function decideGenericField(
  field: ExtractedField,
  category: FieldValueCategory,
  confidence: number,
  context: ApplicationContext,
): FieldDecision {
  if (confidence < config.minAutoFillConfidence) {
    return {
      kind: "yield",
      field,
      valueCategory: category,
      reason: "low_confidence",
      message: `Low-confidence match (${confidence.toFixed(2)}) for "${field.label}" -- deferring to the human.`,
    };
  }
  if (category === "resume_upload") {
    return { kind: "fill-file", field, valueCategory: "resume_upload", confidence };
  }
  if (category === "location" && context.profile.locations[0]) {
    return { kind: "fill", field, valueCategory: category, value: context.profile.locations[0], confidence };
  }
  // No data source yet in the current schema for these categories (name,
  // phone, email, linkedin/portfolio urls, work history, education, cover
  // letters) -- see README.md "Out of scope". Yielding here is correct
  // behavior, not a bug: the agent should never guess contact details.
  return {
    kind: "yield",
    field,
    valueCategory: category,
    reason: "unrecognized_field",
    message: `No data source configured yet for "${category}" -- ask the human to fill "${field.label}".`,
  };
}

export async function matchFields(
  fields: ExtractedField[],
  context: ApplicationContext,
): Promise<FieldDecision[]> {
  const deterministic = new Map<number, FieldValueCategory>();
  const toClassify: { index: number; label: string; type: string; options?: string[] }[] = [];

  fields.forEach((field, index) => {
    const category = deterministicCategory(field);
    if (category) {
      deterministic.set(index, category);
    } else {
      toClassify.push({ index, label: field.label, type: field.type, options: field.options });
    }
  });

  let llmResults: Map<number, { category: FieldValueCategory; confidence: number }>;
  try {
    const classified = await classifyFields(toClassify);
    llmResults = new Map(classified.map((c) => [c.index, { category: c.category, confidence: c.confidence }]));
  } catch {
    // LLM unavailable/unconfigured -- every unmatched field yields to the
    // human rather than the session failing outright.
    llmResults = new Map();
  }

  return fields.map((field, index) => {
    const detCategory = deterministic.get(index);
    const category = detCategory ?? llmResults.get(index)?.category;
    const confidence = detCategory ? 0.95 : llmResults.get(index)?.confidence ?? 0;

    if (!category || category === "other") {
      return {
        kind: "yield",
        field,
        reason: "unrecognized_field",
        message: `Couldn't classify "${field.label}" -- ask the human to fill it.`,
      };
    }

    if (isRequiredInfoCategory(category)) {
      return decideRequiredInfoField(field, category, confidence, context);
    }
    return decideGenericField(field, category, confidence, context);
  });
}
