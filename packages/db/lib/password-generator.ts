// ---------------------------------------------------------------------------
// Password generation for agent-created ATS accounts.
//
// These passwords are never memorized or typed by a human -- they're stored
// encrypted and either replayed by the agent or copied out of the UI. That
// removes the usual memorability constraint entirely, so the only real
// design pressures are (a) enough entropy that the password is irrelevant to
// an attacker's odds, and (b) surviving whatever validation rules the ATS
// signup form happens to impose.
// ---------------------------------------------------------------------------

import { randomInt } from "node:crypto";

const LOWERCASE = "abcdefghijkmnopqrstuvwxyz"; // no 'l'
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 'I', no 'O'
const DIGITS = "23456789"; // no '0', no '1'

// Deliberately conservative symbol set. Every character here is unambiguous
// in a monospace font and survives being pasted into a form field, a shell,
// or a CSV export. Excluded on purpose: quotes and backslash (escaping bugs
// in whatever the ATS does server-side), angle brackets and ampersand (HTML
// escaping), space (silently trimmed by many forms), and the rarer symbols
// that ATS validators tend to reject outright.
const SYMBOLS = "!#$%*+-=?@^_";

const ALL = LOWERCASE + UPPERCASE + DIGITS + SYMBOLS;

/**
 * Default length. At ~5.9 bits per character from the 62-character pool
 * above, 24 characters is roughly 140 bits -- far past the point where
 * guessing the password is the weakest link in this system. It's long
 * without tripping the maximum-length limits some older ATS forms still
 * impose (which is why this is 24 and not 64).
 */
const DEFAULT_LENGTH = 24;

/**
 * Fisher-Yates shuffle using rejection-sampled indices.
 *
 * `randomInt` is used throughout this file rather than `randomBytes` + `%`:
 * the modulo approach silently biases toward the start of the alphabet
 * whenever the pool size doesn't divide 256, and node's `randomInt` already
 * does rejection sampling correctly. The bias would be small here, but it's
 * free to avoid and easy to get wrong.
 */
function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars;
}

/**
 * Generates a password for a newly created ATS account.
 *
 * Guarantees at least one character from each class, because a meaningful
 * number of signup forms enforce that and a rejected password mid-run means
 * the agent stalls on a form it can't complete. The guaranteed characters
 * are placed at random positions rather than appended in class order (the
 * common bug -- it makes the last four characters predictable in kind, and
 * a password whose shape is "20 random chars then Aa1!" leaks structure).
 */
export function generatePassword(length: number = DEFAULT_LENGTH): string {
  if (length < 12) {
    throw new Error("Refusing to generate a password shorter than 12 characters.");
  }

  const required = [
    LOWERCASE[randomInt(0, LOWERCASE.length)]!,
    UPPERCASE[randomInt(0, UPPERCASE.length)]!,
    DIGITS[randomInt(0, DIGITS.length)]!,
    SYMBOLS[randomInt(0, SYMBOLS.length)]!,
  ];

  const rest: string[] = [];
  for (let i = required.length; i < length; i++) {
    rest.push(ALL[randomInt(0, ALL.length)]!);
  }

  return shuffle([...required, ...rest]).join("");
}
