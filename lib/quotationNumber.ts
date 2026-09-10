import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting, SETTING_KEYS } from '@/db/settings';

/**
 * Quotation reference numbers — Q-0001, Q-0002, … (T5.7).
 *
 * Deliberately much simpler than `lib/invoiceNumber.ts`, and the differences
 * are the interesting part:
 *
 *   - **No configurable format.** An invoice number is a legal identifier the
 *     shop may need to match to a paper series, so its format is a setting. A
 *     quotation reference only has to be unique and readable over the phone.
 *   - **No reset period.** The invoice series restarts on 1 April because GST
 *     returns are filed by financial year. A quotation appears on no return, so
 *     there is nothing to restart for, and one unbroken series means a
 *     reference can never be confused with an invoice number.
 *   - **Its own counter**, `quotation_seq`. It has no connection to
 *     `invoice_seq:<period>` and must never advance it: raising ten quotations
 *     and billing none of them has to leave the invoice series untouched.
 */

const PREFIX = 'Q-';
const PAD = 4;

/** The first reference a shop ever issues. */
export const FIRST_QUOTATION_SEQUENCE = 1;

/** Renders a sequence number as it appears on the document. */
export function renderQuotationNumber(sequence: number): string {
  return `${PREFIX}${String(sequence).padStart(PAD, '0')}`;
}

/**
 * Takes the next reference, advancing the counter.
 *
 * Call with the transaction handle that writes the quotation, exactly as
 * invoice numbers are reserved: the counter and the row then commit or roll
 * back together, so a quotation that fails to save cannot consume a reference
 * and two quotations cannot be handed the same one.
 */
export async function reserveQuotationNumber(txn: SQLiteDatabase): Promise<string> {
  const stored = await getSetting(SETTING_KEYS.quotationSeq, txn);
  const lastUsed = stored === null ? null : Number.parseInt(stored, 10);

  const sequence =
    lastUsed !== null && Number.isInteger(lastUsed) && lastUsed >= 1
      ? lastUsed + 1
      : FIRST_QUOTATION_SEQUENCE;

  await setSetting(SETTING_KEYS.quotationSeq, String(sequence), txn);
  return renderQuotationNumber(sequence);
}

/**
 * What the next reference would be, without taking it. For showing on the
 * screen while a quotation is being built.
 */
export async function peekQuotationNumber(db: SQLiteDatabase): Promise<string> {
  const stored = await getSetting(SETTING_KEYS.quotationSeq, db);
  const lastUsed = stored === null ? null : Number.parseInt(stored, 10);

  return renderQuotationNumber(
    lastUsed !== null && Number.isInteger(lastUsed) && lastUsed >= 1
      ? lastUsed + 1
      : FIRST_QUOTATION_SEQUENCE
  );
}
