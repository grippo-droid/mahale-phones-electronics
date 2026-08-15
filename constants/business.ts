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
  gstin: 'PLACEHOLDER_GSTIN', // PLACEHOLDER
  addressLine1: 'PLACEHOLDER_ADDRESS_LINE_1', // PLACEHOLDER
  addressLine2: 'PLACEHOLDER_ADDRESS_LINE_2', // PLACEHOLDER
  city: 'PLACEHOLDER_CITY', // PLACEHOLDER
  state: 'PLACEHOLDER_STATE', // PLACEHOLDER — drives CGST/SGST vs IGST
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
