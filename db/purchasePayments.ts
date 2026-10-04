import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '@/db/init';
import {
  insertLedgerPayment,
  listLedgerPayments,
  listLedgerPaymentsForOwners,
  ownerIdFor,
  removeLedgerPayment,
  updateLedgerPayment,
  type LedgerPayment,
  type LedgerSpec,
  type NewLedgerPayment,
} from '@/db/paymentLedger';
import { purchaseSettlement } from '@/lib/purchase';
import type { PaymentTotals } from '@/lib/payment';

/**
 * What the shop has paid a vendor against one purchase (T10.3).
 *
 * The same ledger as a bill's, through the same core — one row per payment, a
 * running balance, a status computed from the rows and never stored.
 *
 * What is NOT here is the half that made `db/payments.ts` bill-specific: there
 * is no stored document to invalidate, because a purchase is an internal
 * record and is never printed or shared. So these are thin passes through to
 * `db/paymentLedger.ts` with no before-and-after work, which is exactly what
 * the extraction was for.
 */

const PURCHASE_LEDGER: LedgerSpec = {
  table: 'purchase_payments',
  ownerColumn: 'purchase_id',
};

export type PurchasePayment = {
  id: number;
  purchase_id: number;
  amount: number;
  /**
   * Nullable to match `bill_payments` column for column, which is what lets one
   * core drive both. Nothing here writes a NULL — that state exists only for
   * the rows migration 010 created on the bills side — but a shared table shape
   * is worth more than a constraint this table would never exercise.
   */
  paid_on: string | null;
  note: string | null;
  created_at: string;
  edited_at: string | null;
};

export type NewPurchasePayment = NewLedgerPayment;

function asPurchasePayment(row: LedgerPayment): PurchasePayment {
  const { owner_id, ...rest } = row;
  return { ...rest, purchase_id: owner_id };
}

/** Newest first — the instalment being looked for is nearly always the last. */
export async function listPurchasePayments(
  purchaseId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<PurchasePayment[]> {
  const rows = await listLedgerPayments(PURCHASE_LEDGER, purchaseId, db);
  return rows.map(asPurchasePayment);
}

/** The ledgers for several purchases at once, keyed by purchase id. */
export async function listPaymentsForPurchases(
  purchaseIds: number[],
  db: SQLiteDatabase = getDatabase()
): Promise<Map<number, PurchasePayment[]>> {
  const byPurchase = new Map<number, PurchasePayment[]>();
  const grouped = await listLedgerPaymentsForOwners(PURCHASE_LEDGER, purchaseIds, db);
  for (const [purchaseId, rows] of grouped) {
    byPurchase.set(purchaseId, rows.map(asPurchasePayment));
  }
  return byPurchase;
}

/** The purchase's settlement, computed from its rows. Never stored. */
export function totalsFor(
  totalAmount: number,
  payments: PurchasePayment[]
): PaymentTotals {
  return purchaseSettlement(
    { total_amount: totalAmount },
    payments.map((payment) => payment.amount)
  );
}

/**
 * A purchase must exist before money is recorded against it.
 *
 * The foreign key would refuse a bad id anyway, but it would do so with
 * SQLite's wording. This is the same guard `db/payments.ts` gets for free from
 * having to look the bill up for its PDF.
 */
async function assertPurchase(purchaseId: number, db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM purchases WHERE id = ? AND deleted_at IS NULL',
    purchaseId
  );
  if (!row) throw new Error(`Purchase ${purchaseId} not found.`);
}

export async function recordPurchasePayment(
  purchaseId: number,
  payment: NewPurchasePayment,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  await assertPurchase(purchaseId, db);
  await insertLedgerPayment(PURCHASE_LEDGER, purchaseId, payment, db);
}

export async function editPurchasePayment(
  paymentId: number,
  payment: NewPurchasePayment,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  await ownerIdFor(PURCHASE_LEDGER, paymentId, db);
  await updateLedgerPayment(PURCHASE_LEDGER, paymentId, payment, db);
}

export async function deletePurchasePayment(
  paymentId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  await ownerIdFor(PURCHASE_LEDGER, paymentId, db);
  await removeLedgerPayment(PURCHASE_LEDGER, paymentId, db);
}

/**
 * The one-tap shortcut: settle whatever is still owed, in one entry.
 *
 * Only ever moves a purchase TOWARDS settled, like the bill side. There is no
 * un-pay, because there is no honest answer to which of several instalments a
 * stray tap should remove.
 *
 * Returns false when there was nothing outstanding, so the caller can tell "I
 * recorded the balance" from "there was no balance".
 */
export async function settleRemainingPurchase(
  purchaseId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<boolean> {
  const purchase = await db.getFirstAsync<{ total_amount: number }>(
    'SELECT total_amount FROM purchases WHERE id = ? AND deleted_at IS NULL',
    purchaseId
  );
  if (!purchase) throw new Error(`Purchase ${purchaseId} not found.`);

  const payments = await listPurchasePayments(purchaseId, db);
  const { outstanding } = totalsFor(purchase.total_amount, payments);
  if (outstanding <= 0) return false;

  await recordPurchasePayment(
    purchaseId,
    { amount: outstanding, paid_on: new Date().toISOString().slice(0, 10) },
    db
  );
  return true;
}
