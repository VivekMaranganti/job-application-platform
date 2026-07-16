import type { Jurisdiction } from "./criminal-history-jurisdiction";

// ---------------------------------------------------------------------------
// Best-effort parse of `JobListing.location` (free text from whatever ATS
// connector produced the listing, e.g. "New York, NY", "Remote", "San
// Francisco Bay Area") into the { state?, city? } shape
// `isCriminalHistoryAutoModeAllowed` expects.
//
// See packages/db/lib/policy/README.md ("Jurisdiction parsing from
// JobListing.location"). This is deliberately conservative: a location
// string this can't confidently parse a US state abbreviation out of
// returns `{}`, and `isCriminalHistoryAutoModeAllowed({})` -- like
// `isCriminalHistoryAutoModeAllowed(undefined)` -- is already `false`
// unconditionally today (JURISDICTION_POLICY is empty), and would still be
// `false` even once populated, since `{}` matches no key. A failed or
// ambiguous parse can only ever fail closed, never accidentally allow auto
// mode for a jurisdiction that hasn't actually been cleared.
// ---------------------------------------------------------------------------

const US_STATE_ABBREVIATIONS = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il",
  "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt",
  "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri",
  "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
]);

/**
 * Parses "City, ST" (optionally with more trailing text, e.g. "New York, NY
 * (Remote)") into a `Jurisdiction`. Anything else -- "Remote", "United
 * States", freeform region names with no recognizable state code, empty/null
 * -- returns `{}` rather than guessing.
 */
export function parseJurisdiction(location: string | null | undefined): Jurisdiction {
  if (!location) return {};

  const match = location.match(/^\s*([^,]+?)\s*,\s*([A-Za-z]{2})\b/);
  if (!match) return {};

  const [, cityRaw, stateRaw] = match;
  if (!stateRaw || !cityRaw) return {};

  const state = stateRaw.toLowerCase();
  if (!US_STATE_ABBREVIATIONS.has(state)) return {};

  const city = cityRaw.trim();
  if (!city || /^remote$/i.test(city)) return { state: stateRaw.toUpperCase() };

  return { city, state: stateRaw.toUpperCase() };
}
