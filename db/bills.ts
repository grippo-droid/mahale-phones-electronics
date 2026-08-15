import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from './init';
import type { BillItemRow, BillRow } from './schema';

/**
 * Bill CRUD (T1.4).
 *
 * This module stores what it is given; it does not calculate tax. GST is worked
 * out by `lib/gst.ts` (T3.1) and the invoice number by `lib/invoiceNumber.ts`
 * (T3.2), so the tax rules live in one place and stay unit-testable without a
 * database.
 */

export type BillWithItems = BillRow & { items: BillItemRow[] };

export type NewBillItem = {
  /** NULL for a one-off line with no inventory record behind it. */
  product_id: number | null;
  product_name_snapshot: string;
  hsn_code_snapshot?: string | null;
  qty: number;
  unit_price_snapshot: number;
  gst_rate_snapshot: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
};

export type NewBill = {
  /**
   * Supply a number directly, or supply `generateInvoiceNumber` instead and let
   * one be reserved inside the transaction. Exactly one of the two is required.
   */
  invoice_number?: string;
  /**
   * Reserves the invoice number using the transaction handle that writes this
   * bill, so a bill that fails to save cannot consume a number and two bills
   * cannot be handed the same one.
   *
   * Pass `invoiceNumberGenerator()` from `lib/invoiceNumber.ts`. It is injected
   * rather than imported here so that the numbering rules stay in one module and
   * this one keeps storing only what it is given.
   */
  generateInvoiceNumber?: (txn: SQLiteDatabase) => Promise<string>;
  /** Defaults to now. Stored as an ISO 8601 UTC string. */
  date?: Date;
  customer_name: string;
  customer_phone: string;
  customer_address?: string | null;
  customer_gstin?: string | null;
  customer_state: string;
  subtotal: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  grand_total: number;
  pdf_path?: string | null;
  items: NewBillItem[];
};

export type BillListOptions = {
  /** Matches customer name, phone or invoice number. */
  search?: string;
  /** Inclusive lower bound, compared on the local calendar day. */
  from?: Date;
  /** Inclusive upper bound, compared on the local calendar day. */
  to?: Date;
  limit?: number;
  offset?: number;
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Writes a bill, its line items, and the resulting stock decrements as one
 * atomic unit. A crash mid-write can never leave a bill with missing items or
 * stock reduced for a bill that was never saved.
 *
 * Stock is allowed to go negative. The shop's recorded count drifts from what is
 * physically on the shelf, and refusing to bill a customer standing at the
 * counter is worse than a number that needs correcting later — the Inventory
 * screen flags negative stock so it gets fixed.
 */
export async function createBill(
  input: NewBill,
  db: SQLiteDatabase = getDatabase()
): Promise<BillWithItems> {
  validateNewBill(input);

  const date = (input.date ?? new Date()).toISOString();
  const now = new Date().toISOString();
  let billId = -1;

  await db.withExclusiveTransactionAsync(async (txn) => {
    // Reserved in here on purpose: the counter advances and the bill is written
    // in the same unit of work, so neither can happen without the other.
    const invoiceNumber = input.invoice_number
      ? input.invoice_number.trim()
      : await input.generateInvoiceNumber!(txn);

    const result = await txn.runAsync(
      `INSERT INTO bills
         (invoice_number, date, customer_name, customer_phone, customer_address,
          customer_gstin, customer_state, subtotal, cgst_total, sgst_total,
          igst_total, grand_total, pdf_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceNumber,
      date,
      input.customer_name.trim(),
      input.customer_phone.trim(),
      input.customer_address?.trim() || null,
      input.customer_gstin?.trim() || null,
      input.customer_state.trim(),
      input.subtotal,
      input.cgst_total,
      input.sgst_total,
      input.igst_total,
      input.grand_total,
      input.pdf_path ?? null,
      now
    );

    billId = result.lastInsertRowId;

    for (const item of input.items) {
      await txn.runAsync(
        `INSERT INTO bill_items
           (bill_id, product_id, product_name_snapshot, hsn_code_snapshot, qty,
            unit_price_snapshot, gst_rate_snapshot, taxable_value,
            cgst_amount, sgst_amount, igst_amount, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        billId,
        item.product_id,
        item.product_name_snapshot,
        item.hsn_code_snapshot ?? null,
        item.qty,
        item.unit_price_snapshot,
        item.gst_rate_snapshot,
        item.taxable_value,
        item.cgst_amount,
        item.sgst_amount,
        item.igst_amount,
        item.line_total
      );

      if (item.product_id !== null) {
        await txn.runAsync(
          'UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?',
          item.qty,
          now,
          item.product_id
        );
      }
    }
  });

  const created = await getBillById(billId, db);
  if (!created) throw new Error('Bill was inserted but could not be read back.');
  return created;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getBillById(
  id: number,
  db: SQLiteDatabase = getDatabase()
): Promise<BillWithItems | null> {
  const bill = await db.getFirstAsync<BillRow>('SELECT * FROM bills WHERE id = ?', id);
  if (!bill) return null;

  const items = await db.getAllAsync<BillItemRow>(
    'SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id ASC',
    id
  );
  return { ...bill, items };
}

export async function getBillByInvoiceNumber(
  invoiceNumber: string,
  db: SQLiteDatabase = getDatabase()
): Promise<BillWithItems | null> {
  const bill = await db.getFirstAsync<BillRow>(
    'SELECT * FROM bills WHERE invoice_number = ?',
    invoiceNumber
  );
  if (!bill) return null;
  return getBillById(bill.id, db);
}

/** Bill headers only, newest first — the History list (T5.5) does not need items. */
export async function listBills(
  options: BillListOptions = {},
  db: SQLiteDatabase = getDatabase()
): Promise<BillRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (options.search?.trim()) {
    const term = `%${escapeLike(options.search.trim())}%`;
    where.push(
      `(customer_name LIKE ? ESCAPE '\\' OR customer_phone LIKE ? ESCAPE '\\'` +
        ` OR invoice_number LIKE ? ESCAPE '\\')`
    );
    params.push(term, term, term);
  }

  if (options.from) {
    where.push('date >= ?');
    params.push(startOfLocalDay(options.from).toISOString());
  }

  if (options.to) {
    where.push('date <= ?');
    params.push(endOfLocalDay(options.to).toISOString());
  }

  let sql = 'SELECT * FROM bills';
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY date DESC, id DESC';

  if (options.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(options.limit);
    if (options.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }
  }

  return db.getAllAsync<BillRow>(sql, params);
}

/** Recent bills for the Dashboard (T5.3). */
export async function getRecentBills(
  limit = 5,
  db: SQLiteDatabase = getDatabase()
): Promise<BillRow[]> {
  return listBills({ limit }, db);
}

export type SalesSummary = { billCount: number; total: number };

/**
 * Totals over a local-calendar-day range, used for the Dashboard's today/month
 * figures (T5.1). Takes Date objects and converts to the stored UTC strings
 * here, so callers cannot get the timezone boundary wrong — a 9pm bill must
 * count towards that evening, not the next morning.
 */
export async function getSalesSummary(
  from: Date,
  to: Date,
  db: SQLiteDatabase = getDatabase()
): Promise<SalesSummary> {
  const row = await db.getFirstAsync<{ bill_count: number; total: number | null }>(
    'SELECT COUNT(*) AS bill_count, SUM(grand_total) AS total FROM bills WHERE date >= ? AND date <= ?',
    startOfLocalDay(from).toISOString(),
    endOfLocalDay(to).toISOString()
  );
  return { billCount: row?.bill_count ?? 0, total: row?.total ?? 0 };
}

/**
 * Whether a number has already been issued. Cheaper than fetching the bill, and
 * used by `lib/invoiceNumber.ts` on every generated number as a last line of
 * defence against reuse — the UNIQUE constraint would catch it, but only by
 * failing the sale at the counter.
 */
export async function invoiceNumberExists(
  invoiceNumber: string,
  db: SQLiteDatabase = getDatabase()
): Promise<boolean> {
  const row = await db.getFirstAsync<{ found: number }>(
    'SELECT 1 AS found FROM bills WHERE invoice_number = ? LIMIT 1',
    invoiceNumber
  );
  return row !== null;
}

export async function countBills(db: SQLiteDatabase = getDatabase()): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM bills');
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/**
 * Records where the generated PDF was saved. Separate from `createBill` because
 * the PDF is rendered after the bill exists — it needs the invoice number (T4.2).
 */
export async function setBillPdfPath(
  id: number,
  pdfPath: string | null,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  const result = await db.runAsync('UPDATE bills SET pdf_path = ? WHERE id = ?', pdfPath, id);
  if (result.changes === 0) throw new Error(`Bill ${id} not found.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateNewBill(input: NewBill): void {
  const hasNumber = Boolean(input.invoice_number?.trim());
  const hasGenerator = typeof input.generateInvoiceNumber === 'function';

  if (!hasNumber && !hasGenerator) {
    throw new Error('A bill needs an invoice number, or a way to generate one.');
  }
  if (hasNumber && hasGenerator) {
    // Silently preferring one would make it unclear which number was issued.
    throw new Error('Give either an invoice number or a generator, not both.');
  }

  if (!input.customer_name?.trim()) throw new Error('Customer name is required.');
  if (!input.customer_phone?.trim()) throw new Error('Customer phone number is required.');
  if (!input.customer_state?.trim()) {
    throw new Error('Customer state is required — it decides CGST/SGST versus IGST.');
  }
  if (input.items.length === 0) throw new Error('A bill must have at least one item.');

  for (const item of input.items) {
    if (!item.product_name_snapshot?.trim()) throw new Error('Every bill item needs a name.');
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw new Error(`Quantity for "${item.product_name_snapshot}" must be a whole number above zero.`);
    }
  }
}

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
