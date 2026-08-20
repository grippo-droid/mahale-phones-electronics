/**
 * Business details printed on every bill.
 *
 * ============================================================================
 * !!! SOME PLACEHOLDER VALUES REMAIN — see the PLACEHOLDER markers below !!!
 * ============================================================================
 *
 * The shop name, GSTIN, state, address, phone and email are confirmed. What is
 * still a stand-in: the pincode, the bank details, and the invoice numbering.
 * Search this repo for the string "PLACEHOLDER" to find every spot that still
 * needs real data.
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
  // Confirmed by the owner from an existing printed bill. Note the capital
  // "And" — this is the name as it appears on his own paperwork, so it is left
  // exactly as given rather than tidied into house style.
  name: 'Mahale Phones And Electronics',
  // Confirmed by the owner. Check digit verified with lib/gstin.ts, and the
  // state below is its first two digits (23) rather than a separate answer, so
  // the two cannot drift apart.
  gstin: '23ALYPM5121B1ZA',
  // Confirmed by the owner as one line: "Shop no. 7 ARCO COMPLEX Shanwara
  // Burhanpur MP". Split across the fields the invoice template prints on
  // separate lines — premises, then locality, then city. The split is a
  // judgement, not something the owner stated; it changes how the address is
  // laid out on the bill but not what it says.
  addressLine1: 'Shop No. 7, ARCO Complex',
  addressLine2: 'Shanwara',
  city: 'Burhanpur',
  // Confirmed — drives CGST/SGST vs IGST. Must stay spelled as in
  // constants/states.ts, which is what the customer's state is matched against.
  state: 'Madhya Pradesh',
  // Still needed. Not guessed from the city: a wrong pincode on a GST invoice
  // is worse than a blank one, and a PLACEHOLDER prints as an empty gap.
  pincode: 'PLACEHOLDER_PINCODE', // PLACEHOLDER — ask the owner
  phone: '9826351449',
  email: 'mahale71phones@gmail.com',
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
