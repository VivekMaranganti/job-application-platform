// ---------------------------------------------------------------------------
// Keyword-based level/employment-type inference from a job title, shared
// across ATS connectors (originally written for Greenhouse -- see
// connectors/greenhouse/README.md for the full "infer only when confident,
// leave null rather than guess" rationale, which applies unchanged here).
// Pulled out here once a second connector (Lever) needed the identical
// logic, rather than duplicating the regexes per connector.
// ---------------------------------------------------------------------------

export type InferredLevel =
  | "Entry level"
  | "Mid level"
  | "Senior"
  | "Staff / Principal"
  | "Manager"
  | "Director"
  | "Executive / VP";

export type InferredEmploymentType = "Full-time" | "Part-time" | "Contract" | "Internship";

const LEVEL_PATTERNS: Array<{ pattern: RegExp; level: InferredLevel }> = [
  // Order matters: check the most specific/senior signals first so e.g.
  // "Senior Director" resolves to Director-or-above rather than "Senior".
  { pattern: /\b(chief|ceo|cto|cfo|coo|ciso|cmo|cpo|chro|evp|svp|vp|vice president)\b/i, level: "Executive / VP" },
  { pattern: /\bdirector\b/i, level: "Director" },
  { pattern: /\b(staff|principal)\b/i, level: "Staff / Principal" },
  { pattern: /\b(senior|sr\.?)\b/i, level: "Senior" },
  { pattern: /\b(intern(ship)?|entry[ -]level|new grad|junior|jr\.?|associate)\b/i, level: "Entry level" },
];

/**
 * Infers seniority level from a job title only when a clear keyword is
 * present. Deliberately does NOT fall back to "Mid level" or "Manager" for
 * titles with no keyword match: a bare title like "Product Manager" is
 * genuinely ambiguous (no signal either way between entry/mid), and
 * "manager" as a bare keyword is itself ambiguous between an IC title
 * ("Product Manager", "Program Manager") and a people-manager level
 * ("Engineering Manager") -- no ATS gives us enough to disambiguate that
 * from the title alone, so both are left null rather than guessed.
 */
export function inferLevelFromTitle(title: string): InferredLevel | null {
  for (const { pattern, level } of LEVEL_PATTERNS) {
    if (pattern.test(title)) return level;
  }
  return null;
}

/**
 * Same "only when confident" principle as inferLevelFromTitle. No fallback
 * to "Full-time": most postings likely are full-time, but assuming that for
 * everything without an explicit part-time/contract/internship marker would
 * be an assumption, not an inference from the data.
 */
export function inferEmploymentTypeFromTitle(title: string): InferredEmploymentType | null {
  if (/\bintern(ship)?\b/i.test(title)) return "Internship";
  if (/\bcontract(or)?\b/i.test(title)) return "Contract";
  if (/\bpart[ -]?time\b/i.test(title)) return "Part-time";
  return null;
}
