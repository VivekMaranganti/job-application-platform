import type { RequiredFieldId, RequiredFieldMode } from "@/lib/types";

// ---------------------------------------------------------------------------
// Criminal-history "ban-the-box" jurisdiction policy gate (issue #7).
//
// !!! THIS FILE IS A TECHNICAL SCAFFOLD, NOT A LEGAL OPINION. !!!
// Nothing in this file has been reviewed by a lawyer. See README.md in this
// directory before changing `JURISDICTION_POLICY` or the save-time gate
// below -- it explains the process for enabling a jurisdiction and the
// design tradeoff this module resolves.
//
// Issue #7 asks whether "ban-the-box" / fair-chance-hiring laws permit an
// automated agent to answer criminal-history questions on a candidate's
// behalf, and in which states/cities. That is a real legal determination
// this codebase cannot make on its own. This module exists so that
// determination has somewhere safe to land once a human with actual legal
// authority makes it, jurisdiction by jurisdiction. Until then, every
// jurisdiction defaults to "not allowed" -- there is no jurisdiction
// pre-populated as allowed, on purpose.
// ---------------------------------------------------------------------------

export interface Jurisdiction {
  /** US state/territory (e.g. "CA", "NY"). Matched case-insensitively. */
  state?: string;
  /**
   * City/county, for the jurisdictions where the relevant fair-chance law is
   * municipal rather than state-wide (e.g. NYC, San Francisco, Philadelphia,
   * Chicago all have their own ordinances distinct from their state's).
   */
  city?: string;
}

/**
 * The single source of truth for which jurisdictions have been cleared for
 * `criminal_history` auto-mode.
 *
 * INVARIANT: every entry here must be `false` -- and no jurisdiction should
 * be added to this map at all -- until a human with real legal authority has:
 *   1. Reviewed that specific jurisdiction's ban-the-box / fair-chance-hiring
 *      rules (timing restrictions, permissible question scope, disclosure
 *      requirements, etc.), AND
 *   2. Confirmed that this product's specific behavior -- an automated agent
 *      answering the criminal-history question the same way on every
 *      application, with no per-posting human review -- is compliant, AND
 *   3. Signed off via the reviewed-PR process in README.md ("Enabling a
 *      jurisdiction"), not a runtime toggle or admin setting.
 *
 * A jurisdiction absent from this map is treated identically to one present
 * with value `false`. Do not treat "not listed" as "probably fine" --
 * `isCriminalHistoryAutoModeAllowed` treats every unlisted jurisdiction, and
 * every jurisdiction explicitly listed as `false`, as disallowed.
 *
 * This map is intentionally empty. No jurisdiction has undergone the review
 * described above.
 */
const JURISDICTION_POLICY: Record<string, boolean> = {
  // Intentionally empty -- see invariant above. Do not add entries without
  // following the process in README.md ("Enabling a jurisdiction").
};

function normalizeKey(input: string): string {
  return input.trim().toLowerCase();
}

function candidateKeys(jurisdiction: Jurisdiction): string[] {
  const keys: string[] = [];
  if (jurisdiction.city && jurisdiction.state) {
    keys.push(normalizeKey(`${jurisdiction.city},${jurisdiction.state}`));
  }
  if (jurisdiction.city) keys.push(normalizeKey(jurisdiction.city));
  if (jurisdiction.state) keys.push(normalizeKey(jurisdiction.state));
  return keys;
}

/**
 * Whether `criminal_history` auto-mode (the agent silently answering the
 * criminal-history question on the candidate's behalf, with no
 * per-application human review) is currently permitted for a given
 * jurisdiction.
 *
 * THIS IS A TECHNICAL GATE, NOT A LEGAL OPINION. It returns `true` only for
 * jurisdictions explicitly marked reviewed-and-allowed in
 * `JURISDICTION_POLICY` above -- which, as of this writing, is none of
 * them, so this function currently returns `false` unconditionally for
 * every input, including `null`/unknown location. A `false` result does not
 * mean "illegal in this jurisdiction"; it means "not yet cleared for auto
 * mode in this product." Absence of legal review is reason enough to block,
 * regardless of what the real law says.
 *
 * Ban-the-box rules are keyed off where the job/employer is, not where
 * the candidate lives -- callers should pass the job listing's jurisdiction
 * (e.g. `JobListing.location`, parsed), not the candidate's profile
 * location.
 *
 * Intended consumer: issue #4's apply-agent, which should call this
 * per-application, using the specific job being applied to, before ever
 * treating `criminal_history` as auto-fillable -- even though, as of this
 * writing, `saveRequiredInfoAnswer` (apps/web/lib/repository/postgres.ts)
 * additionally blocks `mode=auto` for `criminal_history` outright at save
 * time, so this function should always see mode=manual in practice today.
 * See README.md for the full reasoning on why both gates exist.
 *
 * @param jurisdiction The job's location, or `null`/`undefined` if unknown.
 * @returns `true` only if that exact jurisdiction has been explicitly
 *   reviewed and marked allowed. Defaults to `false` for everything else.
 */
export function isCriminalHistoryAutoModeAllowed(jurisdiction: Jurisdiction | null | undefined): boolean {
  if (!jurisdiction) return false;
  return candidateKeys(jurisdiction).some((key) => JURISDICTION_POLICY[key] === true);
}

/**
 * Save-time gate for `RequiredInfoAnswer.mode` (apps/web/lib/repository).
 *
 * `RequiredInfoAnswer` is a single, global, per-user setting -- it has no
 * concept of which job/jurisdiction it will be used for (see README.md,
 * "The design wrinkle"). Ban-the-box legality, in contrast, depends on the
 * job's location, which isn't known until apply-time. That mismatch means
 * `criminal_history` can never honestly be marked `auto` at save time:
 * whatever gets stored here would need to be legally fine in literally
 * every jurisdiction the user might apply to next, forever, and nothing at
 * save time can check that.
 *
 * So, for `criminal_history` specifically, this unconditionally downgrades
 * a requested `mode: "auto"` to `"manual"` -- independent of, and in
 * addition to, `isCriminalHistoryAutoModeAllowed` above. Every other field
 * passes through unchanged; this module has no opinion on them.
 *
 * Call this wherever a `RequiredInfoAnswer.mode` is about to be persisted
 * (currently: `postgres.ts`'s `saveRequiredInfoAnswer`), so there is exactly
 * one place this can be bypassed from, and it isn't this one.
 *
 * @param fieldId The `RequiredFieldId` being saved.
 * @param requestedMode The mode the caller asked to persist (`undefined` if
 *   the caller isn't changing `mode` in this patch).
 * @returns The mode that should actually be persisted.
 */
export function resolveRequiredInfoModeForSave(
  fieldId: RequiredFieldId,
  requestedMode: RequiredFieldMode | undefined
): RequiredFieldMode | undefined {
  if (fieldId === "criminal_history" && requestedMode === "auto") {
    return "manual";
  }
  return requestedMode;
}
