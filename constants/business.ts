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
  /** Invoice number format. {YYYY} = year, {SEQ} = zero-padded running number. */
  invoiceNumberFormat: string;
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
  invoiceNumberFormat: 'MPE/{YYYY}/{SEQ}', // PLACEHOLDER — confirm convention
  invoiceStartNumber: 1, // PLACEHOLDER — confirm starting number
};

/** True while any required business detail is still a placeholder. */
export function hasPlaceholderBusinessDetails(
  details: BusinessDetails = BUSINESS_DETAILS
): boolean {
  return Object.values(details).some(
    (value) => typeof value === 'string' && value.startsWith('PLACEHOLDER')
  );
}
