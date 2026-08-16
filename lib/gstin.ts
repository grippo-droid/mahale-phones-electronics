/**
 * GSTIN parsing and validation (T3.4).
 *
 * A GSTIN is 15 characters and every part of it means something:
 *
 *   27 AAPFU0939F 1 Z V
 *   ^^ ^^^^^^^^^^ ^ ^ ^
 *   |  |          | | └ check digit, computed from the other 14
 *   |  |          | └── 'Z', reserved
 *   |  |          └──── entity number for that PAN within the state
 *   |  └───────────────  the holder's PAN
 *   └──────────────────  GST state code
 *
 * Two of those parts are worth checking rather than trusting:
 *
 *   - The check digit catches a mistyped or misread character. A GSTIN is
 *     usually copied off a card or a purchase order by hand, and a wrong one on
 *     an invoice means the customer cannot claim the input credit.
 *
 *   - The state code says which state the customer is registered in. If it
 *     disagrees with the state picked on the bill, one of the two is wrong, and
 *     that decides CGST/SGST versus IGST. The caller is expected to surface the
 *     disagreement rather than silently believing either side.
 *
 * Nothing here throws or blocks. GSTIN is optional on a bill, and a customer who
 * reads out a wrong one should not be able to stop the sale being recorded.
 */

import { findStateByCode, type IndianState } from '@/constants/states';

/** The alphabet GSTIN check digits are computed over: 0-9 then A-Z, base 36. */
const CHECKSUM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Two digits, then a PAN (5 letters, 4 digits, 1 letter), then the entity
 * number, then a reserved character, then the check digit.
 *
 * The 14th character is 'Z' on every GSTIN issued so far, but the position is
 * reserved rather than fixed, so it is accepted as any letter or digit and the
 * check digit is left to do the real work.
 */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][0-9A-Z][0-9A-Z]$/;

export type GstinProblem =
  | 'empty'
  | 'length'
  | 'format'
  | 'unknown-state-code'
  | 'checksum';

export type GstinParse = {
  /** Uppercased, with spaces and hyphens stripped — what should be stored. */
  normalised: string;
  valid: boolean;
  problem: GstinProblem | null;
  /** A sentence naming what is wrong, or null when the GSTIN is valid. */
  message: string | null;
  /** The state the GSTIN is registered in, when the code is recognised. */
  state: IndianState | null;
  /** The PAN embedded in the GSTIN, when the shape is right. */
  pan: string | null;
};

/**
 * Strips the separators people put in when reading a GSTIN aloud, and uppercases
 * it. GSTINs are canonically uppercase; a lowercase one is the same number.
 */
export function normaliseGstin(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * The published GSTIN check-digit algorithm: weight the first 14 characters
 * alternately by 2 and 1 from the right, fold each product back into base 36,
 * and the check digit is whatever makes the sum a multiple of 36.
 */
export function gstinCheckDigit(first14: string): string | null {
  if (first14.length !== 14) return null;

  let factor = 2;
  let sum = 0;

  for (let i = first14.length - 1; i >= 0; i--) {
    const codePoint = CHECKSUM_ALPHABET.indexOf(first14[i]);
    if (codePoint < 0) return null;

    const product = codePoint * factor;
    factor = factor === 2 ? 1 : 2;
    // Fold the two base-36 digits of the product back into one.
    sum += Math.floor(product / 36) + (product % 36);
  }

  return CHECKSUM_ALPHABET[(36 - (sum % 36)) % 36];
}

export function parseGstin(input: string): GstinParse {
  const normalised = normaliseGstin(input ?? '');

  const base: GstinParse = {
    normalised,
    valid: false,
    problem: null,
    message: null,
    state: null,
    pan: null,
  };

  if (normalised.length === 0) {
    return { ...base, problem: 'empty', message: null };
  }

  if (normalised.length !== 15) {
    return {
      ...base,
      problem: 'length',
      message: `A GSTIN is 15 characters — this one has ${normalised.length}.`,
    };
  }

  if (!GSTIN_PATTERN.test(normalised)) {
    return {
      ...base,
      problem: 'format',
      message: 'This does not look like a GSTIN. Check it against the customer’s card.',
    };
  }

  const state = findStateByCode(normalised.slice(0, 2));
  const pan = normalised.slice(2, 12);

  if (!state) {
    return {
      ...base,
      problem: 'unknown-state-code',
      message: `“${normalised.slice(0, 2)}” is not a GST state code. Check the first two digits.`,
      pan,
    };
  }

  const expected = gstinCheckDigit(normalised.slice(0, 14));
  if (expected !== normalised[14]) {
    return {
      ...base,
      problem: 'checksum',
      message: 'This GSTIN fails its check digit — one of the characters is wrong.',
      state,
      pan,
    };
  }

  return { ...base, valid: true, state, pan };
}

/** True when the GSTIN is well formed. An empty string is not valid — but it is
 *  also not an error, since GSTIN is optional; check `parse.problem` for that. */
export function isValidGstin(input: string): boolean {
  return parseGstin(input).valid;
}

/** The state a GSTIN belongs to, or null if it cannot be read. */
export function stateForGstin(input: string): IndianState | null {
  return parseGstin(input).state;
}
