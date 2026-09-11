import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '@/db/init';
import { paymentTotalsFor, type PaymentTotals } from '@/lib/payment';

/**
 * The payment ledger for a bill (T9.2).
 *
 * One row per payment received. A customer paying half now and half next week
 * is ordinary, and `bills.paid` had two states for a situation with three — so
 * settlement is now computed from these rows and never stored.
 *
 * ---------------------------------------------------------------------------
 * Every write here clears `bills.pdf_path`, and that is not optional.
 *
 * From T9.3 the stored PDF prints the payments received. A file named by
 * invoice number that still shows yesterday's ledger would be found by
 * `existingBillPdf` and reshared — handing the customer a document that
 * disagrees with the shop's record under the same invoice number, which is the
 * single thing `lib/pdf.ts` exists to prevent.
 *
 * It is done INSIDE each repository function rather than at the call sites.
 * There are four ways to change a ledger — record, edit, delete, and the
 * one-tap shortcut — and a rule that has to be remembered at four call sites is
 * a rule that will be missed at one. The caller still deletes the file itself,
 * because the repository has no business touching the filesystem.
 * ---------------------------------------------------------------------------
 */

export type BillPayment = {
  id: number;
  bill_id: number;
  amount: number;
  /**
   * NULL only for rows migration 010 created, from bills that were already
   * marked paid before there was a ledger. The amount was knowable; the date
   * was never recorded, and inventing one would print a date on a customer's
   * reprinted invoice that nobody entered.
   */
  paid_on: string | null;
  note: string | null;
  created_at: string;
  edited_at: string | null;
};

export type NewPayment = {
  amount: number;
  paid_on: string | null;
  note?: string | null;
};

/** Newest first — the most recent instalment is the one being looked for. */
export async function listPayments(
  billId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<BillPayment[]> {
  return db.getAllAsync<BillPayment>(
    `SELECT id, bill_id, amount, paid_on, note, created_at, edited_at
       FROM bill_payments
      WHERE bill_id = ?
      ORDER BY COALESCE(paid_on, created_at) DESC, id DESC`,
    billId
  );
}

/**
 * The ledgers for several bills at once, keyed by bill id.
 *
 * History and the Dashboard both draw a status tag on every row, and one query
 * per row would put the page count into the query count — the same reason
 * `getProductsByIds` exists for the cart.
 */
export async function listPaymentsForBills(
  billIds: number[],
  db: SQLiteDatabase = getDatabase()
): Promise<Map<number, BillPayment[]>> {
  const byBill = new Map<number, BillPayment[]>();
  if (billIds.length === 0) return byBill;

  const placeholders = billIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<BillPayment>(
    `SELECT id, bill_id, amount, paid_on, note, created_at, edited_at
       FROM bill_payments
      WHERE bill_id IN (${placeholders})
      ORDER BY COALESCE(paid_on, created_at) DESC, id DESC`,
    ...billIds
  );

  for (const row of rows) {
    const bucket = byBill.get(row.bill_id) ?? [];
    bucket.push(row);
    byBill.set(row.bill_id, bucket);
  }
  return byBill;
}

/** The bill's settlement, computed from its rows. Never stored — see lib/payment.ts. */
export function totalsFor(grandTotal: number, payments: BillPayment[]): PaymentTotals {
  return paymentTotalsFor(
    grandTotal,
    payments.map((payment) => payment.amount)
  );
}

/**
 * Clears the stored PDF for a bill whose ledger has changed.
 *
 * Returns the invoice number so the caller can delete the file, or null when
 * the bill has no stored PDF to invalidate.
 */
async function invalidatePdf(billId: number, db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ invoice_number: string; pdf_path: string | null }>(
    'SELECT invoice_number, pdf_path FROM bills WHERE id = ?',
    billId
  );
  if (!row) throw new Error(`Bill ${billId} not found.`);
  if (row.pdf_path === null) return null;

  await db.runAsync('UPDATE bills SET pdf_path = NULL WHERE id = ?', billId);
  return row.invoice_number;
}

export type PaymentWrite = {
  /** The invoice number whose stored PDF the caller should now delete, if any. */
  staleInvoiceNumber: string | null;
};

export async function recordPayment(
  billId: number,
  payment: NewPayment,
  db: SQLiteDatabase = getDatabase()
): Promise<PaymentWrite> {
  const staleInvoiceNumber = await invalidatePdf(billId, db);

  await db.runAsync(
    `INSERT INTO bill_payments (bill_id, amount, paid_on, note, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    billId,
    payment.amount,
    payment.paid_on,
    payment.note ?? null,
    new Date().toISOString()
  );

  return { staleInvoiceNumber };
}

/**
 * Corrects an entry in place.
 *
 * A correction rather than a reversing entry, because the owner is not keeping
 * double-entry books — they are fixing a figure they typed wrongly a minute
 * ago, and a ledger that grows a correction line for every mistyped amount
 * becomes unreadable on a phone. `edited_at` records that it happened.
 */
export async function editPayment(
  paymentId: number,
  payment: NewPayment,
  db: SQLiteDatabase = getDatabase()
): Promise<PaymentWrite> {
  const existing = await db.getFirstAsync<{ bill_id: number }>(
    'SELECT bill_id FROM bill_payments WHERE id = ?',
    paymentId
  );
  if (!existing) throw new Error(`Payment ${paymentId} not found.`);

  const staleInvoiceNumber = await invalidatePdf(existing.bill_id, db);

  await db.runAsync(
    `UPDATE bill_payments
        SET amount = ?, paid_on = ?, note = ?, edited_at = ?
      WHERE id = ?`,
    payment.amount,
    payment.paid_on,
    payment.note ?? null,
    new Date().toISOString(),
    paymentId
  );

  return { staleInvoiceNumber };
}

export async function deletePayment(
  paymentId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<PaymentWrite> {
  const existing = await db.getFirstAsync<{ bill_id: number }>(
    'SELECT bill_id FROM bill_payments WHERE id = ?',
    paymentId
  );
  if (!existing) throw new Error(`Payment ${paymentId} not found.`);

  const staleInvoiceNumber = await invalidatePdf(existing.bill_id, db);
  await db.runAsync('DELETE FROM bill_payments WHERE id = ?', paymentId);

  return { staleInvoiceNumber };
}

/**
 * The one-tap shortcut: settle whatever is still owed, in a single entry.
 *
 * It only ever moves a bill TOWARDS paid. Tapping a bill that is already
 * settled does nothing here — the screen opens the ledger instead. Deleting
 * payment rows on a stray tap is not something to do with money, and there is
 * no honest answer to which of several instalments an "un-pay" would remove.
 *
 * Returns null when there was nothing outstanding, so the caller can tell "I
 * recorded the balance" from "there was no balance".
 */
export async function settleRemaining(
  billId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<PaymentWrite | null> {
  const bill = await db.getFirstAsync<{ grand_total: number }>(
    'SELECT grand_total FROM bills WHERE id = ?',
    billId
  );
  if (!bill) throw new Error(`Bill ${billId} not found.`);

  const payments = await listPayments(billId, db);
  const { outstanding } = totalsFor(bill.grand_total, payments);
  if (outstanding <= 0) return null;

  return recordPayment(
    billId,
    { amount: outstanding, paid_on: new Date().toISOString().slice(0, 10) },
    db
  );
}
