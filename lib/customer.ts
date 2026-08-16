/**
 * Customer details on a bill: validation, and what they imply for tax (T3.4).
 *
 * Kept free of React and SQLite for the same reason as `lib/gst.ts` — the rules
 * about what makes a bill issuable should be testable without a screen.
 *
 * The division that matters here is between an ERROR and a WARNING.
 *
 *   - An error means the bill cannot be written: a required field is missing.
 *     Only name, phone and state qualify. `bills` declares all three NOT NULL,
 *     and state additionally decides the tax heads.
 *
 *   - A warning means something looks wrong but the sale is still real. A GSTIN
 *     that fails its check digit, or one whose state disagrees with the state
 *     picked, is a warning. The shop cannot refuse to bill a customer because
 *     the number on their card was misread, and a blocked sale at a counter
 *     with a queue behind it is worse than an invoice needing a correction.
 */

import { BUSINESS_DETAILS } from '@/constants/business';
import { findStateByName, type IndianState } from '@/constants/states';
import { supplyTypeFor, type SupplyType } from '@/lib/gst';
import { parseGstin } from '@/lib/gstin';

export type Customer = {
  name: string;
  phone: string;
  /** Optional. Printed on the invoice when present. */
  address: string;
  /** Optional. Present for a B2B sale, where the customer claims input credit. */
  gstin: string;
  /** Required — decides CGST/SGST versus IGST. */
  state: string;
};

export const EMPTY_CUSTOMER: Customer = {
  name: '',
  phone: '',
  address: '',
  gstin: '',
  state: '',
};

export type CustomerField = keyof Customer;

export type CustomerIssue = {
  field: CustomerField;
  message: string;
};

export type CustomerValidation = {
  /** True when the bill has everything it needs to be written. */
  canGenerate: boolean;
  /** Blocking, by field. */
  errors: CustomerIssue[];
  /** Non-blocking — shown, but never in the way of generating the bill. */
  warnings: CustomerIssue[];
};

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/**
 * Indian mobile numbers are ten digits starting 6-9. Landlines with an STD code
 * are also ten or eleven digits, so length alone cannot tell them apart — and it
 * should not try to. A shop takes a landline number from a customer sometimes,
 * and refusing it would be wrong.
 *
 * So: fewer than ten digits is an error, because that is not a reachable number
 * however it is read. Anything at least ten digits long is accepted, and a
 * number that is not a recognisable mobile is left to the warning pass.
 */
export function phoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Drop a country code so +91 98765 43210 reads as a ten-digit mobile.
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function isIndianMobile(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phoneDigits(phone));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateCustomer(
  customer: Customer,
  businessState: string = BUSINESS_DETAILS.state
): CustomerValidation {
  const errors: CustomerIssue[] = [];
  const warnings: CustomerIssue[] = [];

  if (customer.name.trim().length === 0) {
    errors.push({ field: 'name', message: 'Customer name is required.' });
  }

  const digits = phoneDigits(customer.phone);
  if (digits.length === 0) {
    errors.push({ field: 'phone', message: 'Phone number is required.' });
  } else if (digits.length < 10) {
    errors.push({
      field: 'phone',
      message: `A phone number needs at least 10 digits — this has ${digits.length}.`,
    });
  } else if (!isIndianMobile(customer.phone) && digits.length === 10) {
    warnings.push({
      field: 'phone',
      message: 'This does not look like a mobile number. Check it if the bill is to be sent by WhatsApp.',
    });
  }

  if (customer.state.trim().length === 0) {
    errors.push({
      field: 'state',
      message: 'Customer state is required — it decides whether the bill is CGST/SGST or IGST.',
    });
  } else if (!findStateByName(customer.state)) {
    errors.push({ field: 'state', message: 'Pick the state from the list.' });
  }

  // --- GSTIN: optional, so every finding here is a warning ---
  const gstin = parseGstin(customer.gstin);

  if (gstin.problem && gstin.problem !== 'empty' && gstin.message) {
    warnings.push({ field: 'gstin', message: gstin.message });
  }

  const mismatch = gstinStateMismatch(customer);
  if (mismatch) {
    warnings.push({
      field: 'gstin',
      message: `This GSTIN is registered in ${mismatch.gstinState.name}, but the state above says ${mismatch.selectedState.name}. One of the two is wrong.`,
    });
  }

  // The business's own state is a placeholder until the owner fills it in. Until
  // then the CGST/SGST-versus-IGST decision cannot be trusted, so say so on the
  // bill being made rather than letting a wrong split print silently.
  if (isPlaceholderState(businessState)) {
    warnings.push({
      field: 'state',
      message:
        'The shop’s own state has not been set yet, so the tax split cannot be worked out correctly. Set it in Settings.',
    });
  }

  return { canGenerate: errors.length === 0, errors, warnings };
}

/** True while the business state is still the unset placeholder. */
export function isPlaceholderState(state: string = BUSINESS_DETAILS.state): boolean {
  return state.trim().length === 0 || state.startsWith('PLACEHOLDER');
}

/**
 * The state a customer's GSTIN says, when it disagrees with the state picked.
 * Only reported for a GSTIN that passes its check digit — a number that is
 * already known to be mistyped has nothing trustworthy to say about a state.
 */
export function gstinStateMismatch(
  customer: Customer
): { gstinState: IndianState; selectedState: IndianState } | null {
  const gstin = parseGstin(customer.gstin);
  if (!gstin.valid || !gstin.state) return null;

  const selected = findStateByName(customer.state);
  if (!selected) return null;

  if (selected.code === gstin.state.code) return null;
  return { gstinState: gstin.state, selectedState: selected };
}

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

/**
 * The supply type for a bill, or null while it cannot honestly be decided —
 * either the customer's state is not set yet, or the shop's own state is still
 * a placeholder.
 *
 * Returning null rather than guessing 'intra-state' is deliberate. A default
 * would produce a CGST/SGST breakdown that looks authoritative and could be
 * wrong; the screen should show nothing rather than something false.
 */
export function resolveSupplyType(
  customerState: string,
  businessState: string = BUSINESS_DETAILS.state
): SupplyType | null {
  if (isPlaceholderState(businessState)) return null;
  if (customerState.trim().length === 0) return null;
  return supplyTypeFor(businessState, customerState);
}

/** Trims the free-text fields and canonicalises the GSTIN before storing. */
export function normaliseCustomer(customer: Customer): Customer {
  return {
    name: customer.name.trim().replace(/\s+/g, ' '),
    phone: customer.phone.trim(),
    address: customer.address.trim(),
    gstin: customer.gstin.replace(/[\s-]/g, '').toUpperCase(),
    state: customer.state.trim(),
  };
}
