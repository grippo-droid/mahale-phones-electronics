import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from './init';
import { likeClause, likeTerm } from '@/lib/likeSearch';
import type { BillEditRow, BillItemRow, BillRow } from './schema';

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
  /** One of `lib/units.ts`. NULL/omitted means no unit was chosen for this line. */
  unit?: string | null;
  /** The price as entered, BEFORE any discount. */
  unit_price_snapshot: number;
  gst_rate_snapshot: number;
  /** Whether that snapshot already contains GST (migration 011). */
  price_includes_gst?: number | null;
  /** The discount agreed on this line, and what it actually took off. */
  discount_type?: string | null;
  discount_value?: number | null;
  discount_amount?: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
};

/**
 * Writes one line. ONE definition, used by both `createBill` and `editBill`.
 *
 * They carried identical inserts until migration 011 added four columns to
 * each, which is where two copies stop being harmless: a column added to one
 * and forgotten in the other means an edited bill silently loses its discount,
 * and the bill still looks right everywhere except the money. The category
 * chips taught this lesson once already.
 */
async function insertBillItem(
  txn: SQLiteDatabase,
  billId: number,
  item: NewBillItem
): Promise<void> {
  await txn.runAsync(
    `INSERT INTO bill_items
       (bill_id, product_id, product_name_snapshot, hsn_code_snapshot, qty, unit,
        unit_price_snapshot, gst_rate_snapshot, price_includes_gst,
        discount_type, discount_value, discount_amount,
        taxable_value, cgst_amount, sgst_amount, igst_amount, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    billId,
    item.product_id,
    item.product_name_snapshot,
    item.hsn_code_snapshot ?? null,
    item.qty,
    item.unit ?? null,
    item.unit_price_snapshot,
    item.gst_rate_snapshot,
    item.price_includes_gst ?? null,
    item.discount_type ?? null,
    item.discount_value ?? null,
    item.discount_amount ?? 0,
    item.taxable_value,
    item.cgst_amount,
    item.sgst_amount,
    item.igst_amount,
    item.line_total
  );
}

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
  /** The "Round Off" line on the invoice. Defaults to 0 when nothing was rounded. */
  round_off?: number;
  grand_total: number;
  pdf_path?: string | null;
  /** 'Cash' or 'Credit'. NULL/omitted means it was not recorded. */
  payment_type?: string | null;
  /** true paid, false not paid, NULL/omitted not recorded. */
  paid?: boolean | null;
  /**
   * Runs inside the same transaction as the bill, after it and its lines are
   * written, with the new bill's id.
   *
   * Injected for the same reason `generateInvoiceNumber` is: some things have
   * to commit or roll back with the bill, and SQLite will not nest a
   * transaction, so a caller cannot wrap `createBill` in one of its own.
   * Converting a quotation is the case this exists for — marking the quotation
   * converted has to be part of writing the bill, or a failure between the two
   * leaves a bill nothing points at and a quotation still convertible.
   *
   * Throwing in here rolls the whole bill back.
   */
  afterInsert?: (txn: SQLiteDatabase, billId: number) => Promise<void>;
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
          igst_total, round_off, grand_total, pdf_path, payment_type, paid,
          created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.round_off ?? 0,
      input.grand_total,
      input.pdf_path ?? null,
      input.payment_type ?? null,
      // Stored as 1/0/NULL. Written this way rather than `input.paid ? 1 : 0`
      // so "not recorded" survives as NULL instead of collapsing into "not paid".
      input.paid === null || input.paid === undefined ? null : input.paid ? 1 : 0,
      now
    );

    billId = result.lastInsertRowId;

    for (const item of input.items) {
      await insertBillItem(txn, billId, item);

      if (item.product_id !== null) {
        await txn.runAsync(
          'UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?',
          item.qty,
          now,
          item.product_id
        );
      }
    }

    // Last, so it sees a bill that is fully written. Still inside the
    // transaction, so anything it throws takes the bill with it.
    /**
     * A bill saved as paid opens its ledger with one entry for the full
     * amount, written in this same transaction (T9.2).
     *
     * This is what preserves the old convenience: a cash sale is money in
     * hand, so it starts settled and needs no second action. It is only a
     * starting point — the owner can reduce or remove the entry if the
     * customer in fact paid part.
     *
     * Driven by `input.paid` rather than by the payment type, because the type
     * only supplies that flag's default and the owner can override it before
     * saving. A NULL `paid` writes nothing at all: it means nothing was
     * recorded, and an empty ledger is exactly that.
     */
    if (input.paid === true && input.grand_total > 0) {
      await txn.runAsync(
        `INSERT INTO bill_payments (bill_id, amount, paid_on, created_at)
         VALUES (?, ?, ?, ?)`,
        billId,
        input.grand_total,
        date.slice(0, 10),
        now
      );
    }

    if (input.afterInsert) await input.afterInsert(txn, billId);
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

/**
 * Turns the caller's filters into a WHERE clause and its parameters.
 *
 * Shared by `listBills` and `summariseBills` so the History screen's count and
 * total describe exactly the rows it is showing. Two copies of this would drift,
 * and the way that shows up is a heading reading "42 bills" above a list of 38 —
 * which reads as bills having gone missing.
 */
function buildBillFilter(options: BillListOptions): {
  clause: string;
  params: (string | number)[];
} {
  // Deleted bills are not the shop's sales, so they leave every list and every
  // total through this one clause — `listBills` and `summariseBills` both build
  // their WHERE here, which is what keeps a History page and its own summary
  // describing the same set of rows.
  const where: string[] = ['deleted_at IS NULL'];
  const params: (string | number)[] = [];

  if (options.search?.trim()) {
    const columns = ['customer_name', 'customer_phone', 'invoice_number'];
    const term = likeTerm(options.search);
    where.push(likeClause(columns));
    // One bound copy per expression, in the same order.
    params.push(...columns.map(() => term));
  }

  if (options.from) {
    where.push('date >= ?');
    params.push(startOfLocalDay(options.from).toISOString());
  }

  if (options.to) {
    where.push('date <= ?');
    params.push(endOfLocalDay(options.to).toISOString());
  }

  return { clause: where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '', params };
}

/** Bill headers only, newest first — the History list (T5.5) does not need items. */
export async function listBills(
  options: BillListOptions = {},
  db: SQLiteDatabase = getDatabase()
): Promise<BillRow[]> {
  const { clause, params } = buildBillFilter(options);

  let sql = `SELECT * FROM bills${clause} ORDER BY date DESC, id DESC`;

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

/**
 * How many bills match a filter, and what they come to (T5.5).
 *
 * `limit` and `offset` are deliberately ignored: this describes the whole
 * matching set, not the page currently on screen. Totalling the loaded page
 * instead would give a figure that climbs as the list is scrolled — worse than
 * showing nothing, because it looks authoritative and is wrong until the last
 * page has loaded.
 *
 * Distinct from `getSalesSummary`, which takes only dates. This one also honours
 * the search term, so what a particular customer has spent is a search away.
 */
export async function summariseBills(
  options: BillListOptions = {},
  db: SQLiteDatabase = getDatabase()
): Promise<SalesSummary> {
  const { clause, params } = buildBillFilter(options);
  const row = await db.getFirstAsync<{ bill_count: number; total: number | null }>(
    `SELECT COUNT(*) AS bill_count, SUM(grand_total) AS total FROM bills${clause}`,
    params
  );
  return { billCount: row?.bill_count ?? 0, total: row?.total ?? 0 };
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
    `SELECT COUNT(*) AS bill_count, SUM(grand_total) AS total FROM bills
      WHERE date >= ? AND date <= ? AND deleted_at IS NULL`,
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
 *
 * This one deliberately does NOT exclude deleted bills, unlike every other read
 * here. A deleted bill's number is still an issued number: the customer may be
 * holding the printed copy, and handing it to somebody else would be far worse
 * than the gap the deletion leaves in the sequence. That is the whole reason
 * deletion is soft.
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
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM bills WHERE deleted_at IS NULL');
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/**
 * Records where the generated PDF was saved. Separate from `createBill` because
 * the PDF is rendered after the bill exists — it needs the invoice number (T4.2).
 */
/**
 * Marks a bill paid or not paid, long after it was raised.
 *
 * Separate from everything else on a bill because this is the one thing about a
 * finished bill that legitimately changes: the money arrives later. The rest is
 * a record of what was agreed and must not be edited.
 */
// ---------------------------------------------------------------------------
// Edit and delete (T5.8)
// ---------------------------------------------------------------------------

/** Everything an edit may change. The invoice number and date are not in it. */
export type BillEdit = {
  customer_name: string;
  customer_phone: string;
  customer_address?: string | null;
  customer_gstin?: string | null;
  customer_state: string;
  subtotal: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off?: number;
  grand_total: number;
  payment_type?: string | null;
  paid?: boolean | null;
  items: NewBillItem[];
};

/** What a bill looked like before an edit, as stored in `bill_edits.snapshot`. */
export type BillSnapshot = {
  subtotal: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  payment_type: string | null;
  paid: number | null;
  customer_name: string;
  customer_phone: string;
  customer_state: string;
  items: {
    product_id: number | null;
    product_name_snapshot: string;
    qty: number;
    unit: string | null;
    unit_price_snapshot: number;
    gst_rate_snapshot: number;
    line_total: number;
  }[];
};

/** Units per product across a set of lines, for working out a stock change. */
function quantitiesByProduct(
  items: { product_id: number | null; qty: number }[]
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const item of items) {
    // A line whose product was deleted has nothing to adjust. It can still be
    // billed and edited; there is simply no stock behind it.
    if (item.product_id === null) continue;
    totals.set(item.product_id, (totals.get(item.product_id) ?? 0) + item.qty);
  }
  return totals;
}

/**
 * Changes a bill's contents, keeping its invoice number and its date.
 *
 * The invoice number stays because it is the customer's reference and may
 * already be on a printed copy. The date stays because it decides the GST
 * return period the sale falls in — moving it would refile the sale in a
 * different month.
 *
 * **Stock is adjusted by the DIFFERENCE, in one statement per product.** Not
 * "add the old quantities back, then take the new ones off": that passes
 * through a value which is briefly wrong, and if anything failed between the
 * two the shop would be left with stock silently inflated by a whole bill.
 * Billing one more unit takes one more off the shelf; billing one fewer puts
 * one back; a line removed returns all of it; a line added takes all of it.
 *
 * The version being replaced is written to `bill_edits` first, so what the
 * customer was originally given is still on record if they turn up with it.
 *
 * `pdf_path` is cleared, because the file it names still holds the OLD figures
 * under the SAME invoice number — sharing it after an edit would hand the
 * customer a document that disagrees with the shop's record, which is the one
 * thing the PDF module exists to prevent. The caller deletes the file itself.
 */
export async function editBill(
  id: number,
  edit: BillEdit,
  db: SQLiteDatabase = getDatabase()
): Promise<BillWithItems> {
  if (edit.items.length === 0) {
    throw new Error('A bill needs at least one item.');
  }

  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    const before = await txn.getFirstAsync<BillRow>('SELECT * FROM bills WHERE id = ?', id);
    if (!before) throw new Error(`Bill ${id} not found.`);
    if (before.deleted_at !== null) throw new Error('A deleted bill cannot be edited.');

    const beforeItems = await txn.getAllAsync<BillItemRow>(
      'SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id ASC',
      id
    );

    const snapshot: BillSnapshot = {
      subtotal: before.subtotal,
      cgst_total: before.cgst_total,
      sgst_total: before.sgst_total,
      igst_total: before.igst_total,
      round_off: before.round_off,
      grand_total: before.grand_total,
      payment_type: before.payment_type,
      paid: before.paid,
      customer_name: before.customer_name,
      customer_phone: before.customer_phone,
      customer_state: before.customer_state,
      items: beforeItems.map((item) => ({
        product_id: item.product_id,
        product_name_snapshot: item.product_name_snapshot,
        qty: item.qty,
        unit: item.unit,
        unit_price_snapshot: item.unit_price_snapshot,
        gst_rate_snapshot: item.gst_rate_snapshot,
        line_total: item.line_total,
      })),
    };

    await txn.runAsync(
      'INSERT INTO bill_edits (bill_id, edited_at, snapshot) VALUES (?, ?, ?)',
      id,
      now,
      JSON.stringify(snapshot)
    );

    const wasBilled = quantitiesByProduct(beforeItems);
    const nowBilled = quantitiesByProduct(edit.items);

    for (const productId of new Set([...wasBilled.keys(), ...nowBilled.keys()])) {
      const delta = (nowBilled.get(productId) ?? 0) - (wasBilled.get(productId) ?? 0);
      if (delta === 0) continue;
      await txn.runAsync(
        'UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?',
        delta,
        now,
        productId
      );
    }

    await txn.runAsync('DELETE FROM bill_items WHERE bill_id = ?', id);

    for (const item of edit.items) {
      await insertBillItem(txn, id, item);
    }

    await txn.runAsync(
      `UPDATE bills
          SET customer_name = ?, customer_phone = ?, customer_address = ?,
              customer_gstin = ?, customer_state = ?,
              subtotal = ?, cgst_total = ?, sgst_total = ?, igst_total = ?,
              round_off = ?, grand_total = ?,
              payment_type = ?, paid = ?,
              pdf_path = NULL, edited_at = ?
        WHERE id = ?`,
      edit.customer_name.trim(),
      edit.customer_phone.trim(),
      edit.customer_address?.trim() || null,
      edit.customer_gstin?.trim() || null,
      edit.customer_state.trim(),
      edit.subtotal,
      edit.cgst_total,
      edit.sgst_total,
      edit.igst_total,
      edit.round_off ?? 0,
      edit.grand_total,
      edit.payment_type ?? null,
      edit.paid === null || edit.paid === undefined ? null : edit.paid ? 1 : 0,
      now,
      id
    );
  });

  const updated = await getBillById(id, db);
  if (!updated) throw new Error('Bill was edited but could not be read back.');
  return updated;
}

/** The prior versions of a bill, newest first. Only read if a dispute arises. */
export async function listBillEdits(
  billId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<{ editedAt: string; snapshot: BillSnapshot }[]> {
  const rows = await db.getAllAsync<BillEditRow>(
    'SELECT * FROM bill_edits WHERE bill_id = ? ORDER BY edited_at DESC, id DESC',
    billId
  );

  return rows.flatMap((row) => {
    try {
      return [{ editedAt: row.edited_at, snapshot: JSON.parse(row.snapshot) as BillSnapshot }];
    } catch {
      // A snapshot that will not parse is worth skipping rather than throwing:
      // this is reference material, and one bad row must not hide the others.
      return [];
    }
  });
}

/**
 * Marks a bill deleted, optionally putting its stock back.
 *
 * Soft: the row stays and the invoice number stays consumed. Reissuing that
 * number would hand two customers the same reference, which is worse than the
 * gap a deletion leaves in the sequence — and the customer may still be holding
 * the printed copy, so the record is worth keeping either way.
 *
 * Whether stock comes back is asked every time and never assumed. Both answers
 * are ordinary: a bill entered by mistake never left the shelf, so its stock
 * should return; a bill deleted because the goods went out unbilled should not
 * put anything back. Guessing would be wrong about half the time, silently.
 */
export async function deleteBill(
  id: number,
  options: { restoreStock: boolean },
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    const bill = await txn.getFirstAsync<BillRow>('SELECT * FROM bills WHERE id = ?', id);
    if (!bill) throw new Error(`Bill ${id} not found.`);
    // Deleting twice must not put the stock back twice.
    if (bill.deleted_at !== null) return;

    if (options.restoreStock) {
      const items = await txn.getAllAsync<BillItemRow>(
        'SELECT * FROM bill_items WHERE bill_id = ?',
        id
      );
      for (const [productId, qty] of quantitiesByProduct(items)) {
        await txn.runAsync(
          'UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?',
          qty,
          now,
          productId
        );
      }
    }

    await txn.runAsync('UPDATE bills SET deleted_at = ? WHERE id = ?', now, id);
  });
}

export async function setBillPaid(
  id: number,
  paid: boolean,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  const result = await db.runAsync('UPDATE bills SET paid = ? WHERE id = ?', paid ? 1 : 0, id);
  if (result.changes === 0) throw new Error(`Bill ${id} not found.`);
}

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

  // Neither is required (T9.5). A counter sale to someone who gives no name is
  // ordinary; the state still blocks, because it decides the tax heads.
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

