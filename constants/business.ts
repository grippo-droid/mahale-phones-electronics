/**
 * Business details printed on every bill.
 *
 * ============================================================================
 * !!! PLACEHOLDER VALUES — MUST BE REPLACED BEFORE THE APP IS USED FOR REAL !!!
 * ============================================================================
 *
 * Every value marked PLACEHOLDER below comes from PRD Section 8 and is a
 * stand-in. Search this repo for the string "PLACEHOLDER" to find every spot
 * that still needs real data.
 *
 * From T4.1 onward these values become editable in the Settings screen and are
 * persisted locally; this file then only supplies the first-run defaults.
 */

// Type-only import, erased at compile time — no runtime cycle with lib/invoiceNumber.
import type { InvoiceResetPolicy } from '@/lib/invoiceNumber';

// Value imports. Neither reaches back to this module, so there is no cycle:
// lib/gstin depends only on constants/states, which depends on nothing.
import { findStateByName } from '@/constants/states';
import { parseGstin } from '@/lib/gstin';

export type BusinessDetails = {
  name: string;
  gstin: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  /** Must match the state names used for customers so GST can pick CGST/SGST vs IGST. */
  state: string;
  pincode: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  logoPath: string | null;
  /** Invoice number format. See INVOICE_FORMAT_TOKENS in `lib/invoiceNumber.ts`. */
  invoiceNumberFormat: string;
  /** When the running number restarts. Must match the format's period token. */
  invoiceResetPolicy: InvoiceResetPolicy;
  /** The number the first bill gets — set higher to continue a paper bill book. */
  invoiceStartNumber: number;
};

export const BUSINESS_DETAILS: BusinessDetails = {
  // PRD Section 8 — confirm the exact registered business name.
  name: 'Mahale Phones and Electronics', // PLACEHOLDER — confirm registered name
  // Confirmed by the owner. Check digit verified with lib/gstin.ts, and the
  // state below is its first two digits (23) rather than a separate answer, so
  // the two cannot drift apart.
  gstin: '23ALYPM5121B1ZA',
  addressLine1: 'PLACEHOLDER_ADDRESS_LINE_1', // PLACEHOLDER
  addressLine2: 'PLACEHOLDER_ADDRESS_LINE_2', // PLACEHOLDER
  city: 'PLACEHOLDER_CITY', // PLACEHOLDER
  // Confirmed — drives CGST/SGST vs IGST. Must stay spelled as in
  // constants/states.ts, which is what the customer's state is matched against.
  state: 'Madhya Pradesh',
  pincode: 'PLACEHOLDER_PINCODE', // PLACEHOLDER
  phone: 'PLACEHOLDER_PHONE', // PLACEHOLDER
  email: 'PLACEHOLDER_EMAIL', // PLACEHOLDER
  bankName: 'PLACEHOLDER_BANK_NAME', // PLACEHOLDER — optional, bill footer
  bankAccountNumber: 'PLACEHOLDER_ACCOUNT_NUMBER', // PLACEHOLDER — optional
  bankIfsc: 'PLACEHOLDER_IFSC', // PLACEHOLDER — optional
  logoPath: null, // PLACEHOLDER — optional shop logo
  // PLACEHOLDER — confirm the convention. {FY} rather than {YYYY} because the
  // number restarts on 1 April: a calendar year token would let two bills in the
  // same calendar year but different financial years render the same number.
  invoiceNumberFormat: 'MPE/{FY}/{SEQ}', // PLACEHOLDER — e.g. MPE/2026-27/0001
  invoiceResetPolicy: 'financial-year', // PLACEHOLDER — confirm; Indian convention
  invoiceStartNumber: 1, // PLACEHOLDER — confirm; raise to continue a paper series
};

/** True while any required business detail is still a placeholder. */
export function hasPlaceholderBusinessDetails(
  details: BusinessDetails = BUSINESS_DETAILS
): boolean {
  return Object.values(details).some(
    (value) => typeof value === 'string' && value.startsWith('PLACEHOLDER')
  );
}

/**
 * Checks the shop's own state against the state code inside its own GSTIN.
 *
 * The same cross-check the billing screen runs on a customer, pointed at the
 * business. It matters more here: the customer's state is one bill, the shop's
 * state is the reference every bill is compared against, so getting it wrong
 * flips CGST/SGST and IGST on all of them at once.
 *
 * Returns null when the two agree, or when either is still unset. Meant for the
 * Settings screen in T4.1, where both become editable and can be made to
 * disagree by editing one of them.
 */
export function businessStateGstinMismatch(
  details: BusinessDetails = BUSINESS_DETAILS
): { gstinState: string; declaredState: string } | null {
  if (details.gstin.startsWith('PLACEHOLDER') || details.state.startsWith('PLACEHOLDER')) {
    return null;
  }

  const parsed = parseGstin(details.gstin);
  if (!parsed.valid || !parsed.state) return null;

  const declared = findStateByName(details.state);
  if (!declared) return null;
  if (declared.code === parsed.state.code) return null;

  return { gstinState: parsed.state.name, declaredState: declared.name };
}
