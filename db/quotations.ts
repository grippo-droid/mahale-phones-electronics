import type { SQLiteDatabase } from 'expo-sqlite';

import { createBill, type NewBill } from './bills';
import { getDatabase } from './init';
import type { QuotationEditRow, QuotationItemRow, QuotationRow } from './schema';
import { SETTING_KEYS } from './settings';
import { likeClause, likeTerm } from '@/lib/likeSearch';
import { reserveQuotationNumber } from '@/lib/quotationNumber';

/**
 * Quotations (T5.7) — an offer to a customer, kept separate from bills.
 *
 * What makes this its own table rather than a flag on `bills`:
 *
 *   - It takes no invoice number and must never advance that counter. Ten
 *     quotations and no sales has to leave the invoice series untouched.
 *   - It does not move stock. Nothing is sold until a bill is raised.
 *   - It carries no CGST/SGST/IGST split, because that is decided by the
 *     customer's state at the time of sale and a quotation does not collect it.
 *   - It can be superseded. A bill is a permanent record of something that
 *     happened; a quotation is a proposal that may simply expire.
 *
 * Putting all of that behind a nullable column on `bills` would mean every
 * query about sales had to remember to exclude the ones that were not sales.
 */

export type QuotationWithItems = QuotationRow & { items: QuotationItemRow[] };

export type NewQuotationItem = {
  product_id: number | null;
  product_name_snapshot: string;
  hsn_code_snapshot?: string | null;
  qty: number;
  unit?: string | null;
  unit_price_snapshot: number;
  gst_rate_snapshot: number;
  price_includes_gst: boolean;
  taxable_value: number;
  gst_amount: number;
  line_total: number;
};

export type NewQuotation = {
  /** Defaults to now. */
  date?: Date;
  customer_name: string;
  customer_phone: string;
  customer_address?: string | null;
  subtotal: number;
  gst_total: number;
  grand_total: number;
  items: NewQuotationItem[];
};

export type QuotationListOptions = {
  /** Matches customer name, phone or reference number. */
  search?: string;
  /** Only quotations that have not become a bill. */
  openOnly?: boolean;
  limit?: number;
  offset?: number;
};


// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Writes a quotation and its lines as one unit.
 *
 * The reference is reserved inside the transaction, exactly as an invoice
 * number is: a quotation that fails to save must not consume a reference, and
 * two quotations must never be handed the same one.
 *
 * No stock is touched. That is the whole point of a quotation.
 */
export async function createQuotation(
  input: NewQuotation,
  db: SQLiteDatabase = getDatabase()
): Promise<QuotationWithItems> {
  if (input.items.length === 0) {
    throw new Error('A quotation needs at least one item.');
  }

  const date = (input.date ?? new Date()).toISOString();
  const now = new Date().toISOString();
  let quotationId = -1;

  await db.withExclusiveTransactionAsync(async (txn) => {
    const reference = await reserveQuotationNumber(txn);

    const result = await txn.runAsync(
      `INSERT INTO quotations
         (reference_number, date, customer_name, customer_phone, customer_address,
          subtotal, gst_total, grand_total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reference,
      date,
      input.customer_name.trim(),
      input.customer_phone.trim(),
      input.customer_address?.trim() || null,
      input.subtotal,
      input.gst_total,
      input.grand_total,
      now
    );

    quotationId = result.lastInsertRowId;

    for (const item of input.items) {
      await txn.runAsync(
        `INSERT INTO quotation_items
           (quotation_id, product_id, product_name_snapshot, hsn_code_snapshot, qty, unit,
            unit_price_snapshot, gst_rate_snapshot, price_includes_gst,
            taxable_value, gst_amount, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        quotationId,
        item.product_id,
        item.product_name_snapshot,
        item.hsn_code_snapshot ?? null,
        item.qty,
        item.unit ?? null,
        item.unit_price_snapshot,
        item.gst_rate_snapshot,
        item.price_includes_gst ? 1 : 0,
        item.taxable_value,
        item.gst_amount,
        item.line_total
      );
    }
  });

  const created = await getQuotationById(quotationId, db);
  if (!created) throw new Error('Quotation was inserted but could not be read back.');
  return created;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getQuotationById(
  id: number,
  db: SQLiteDatabase = getDatabase()
): Promise<QuotationWithItems | null> {
  const quotation = await db.getFirstAsync<QuotationRow>(
    'SELECT * FROM quotations WHERE id = ?',
    id
  );
  if (!quotation) return null;

  const items = await db.getAllAsync<QuotationItemRow>(
    'SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
    id
  );
  return { ...quotation, items };
}

export async function listQuotations(
  options: QuotationListOptions = {},
  db: SQLiteDatabase = getDatabase()
): Promise<QuotationRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (options.search?.trim()) {
    const columns = ['customer_name', 'customer_phone', 'reference_number'];
    const term = likeTerm(options.search);
    where.push(likeClause(columns));
    params.push(...columns.map(() => term));
  }

  if (options.openOnly) where.push('converted_bill_id IS NULL');

  let sql = 'SELECT * FROM quotations';
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

  return db.getAllAsync<QuotationRow>(sql, params);
}

export async function countQuotations(db: SQLiteDatabase = getDatabase()): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM quotations'
  );
  return row?.count ?? 0;
}

export async function setQuotationPdfPath(
  id: number,
  pdfPath: string | null,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  const result = await db.runAsync('UPDATE quotations SET pdf_path = ? WHERE id = ?', pdfPath, id);
  if (result.changes === 0) throw new Error(`Quotation ${id} not found.`);
}

// ---------------------------------------------------------------------------
// Edit and delete (T5.9)
// ---------------------------------------------------------------------------

/** What a quotation looked like before an edit, as stored in the snapshot. */
export type QuotationSnapshot = {
  subtotal: number;
  gst_total: number;
  grand_total: number;
  customer_name: string;
  customer_phone: string;
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

/**
 * Changes a quotation's contents, keeping its reference number.
 *
 * **A converted quotation is still editable, and editing it does not touch the
 * bill.** From the moment a bill is raised the two are separate documents: the
 * bill is the record of a sale that happened, the quotation is the offer that
 * led to it. Correcting a typo on the offer must not reach into a tax record,
 * and refusing to correct it would make the offer permanently wrong. The
 * quotation screen says which bill it became, so the split is visible rather
 * than surprising.
 *
 * No stock is touched, because a quotation never moved any.
 *
 * `pdf_path` is cleared for the same reason a bill's is: the file is named by
 * reference number and still holds the pre-edit figures, so resharing it would
 * hand the customer a document that disagrees with what the app now says.
 */
export async function editQuotation(
  id: number,
  input: Omit<NewQuotation, 'date'>,
  db: SQLiteDatabase = getDatabase()
): Promise<QuotationWithItems> {
  if (input.items.length === 0) {
    throw new Error('A quotation needs at least one item.');
  }

  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    const before = await txn.getFirstAsync<QuotationRow>(
      'SELECT * FROM quotations WHERE id = ?',
      id
    );
    if (!before) throw new Error(`Quotation ${id} not found.`);

    const beforeItems = await txn.getAllAsync<QuotationItemRow>(
      'SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
      id
    );

    const snapshot: QuotationSnapshot = {
      subtotal: before.subtotal,
      gst_total: before.gst_total,
      grand_total: before.grand_total,
      customer_name: before.customer_name,
      customer_phone: before.customer_phone,
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
      'INSERT INTO quotation_edits (quotation_id, edited_at, snapshot) VALUES (?, ?, ?)',
      id,
      now,
      JSON.stringify(snapshot)
    );

    await txn.runAsync('DELETE FROM quotation_items WHERE quotation_id = ?', id);

    for (const item of input.items) {
      await txn.runAsync(
        `INSERT INTO quotation_items
           (quotation_id, product_id, product_name_snapshot, hsn_code_snapshot, qty, unit,
            unit_price_snapshot, gst_rate_snapshot, price_includes_gst,
            taxable_value, gst_amount, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        item.product_id,
        item.product_name_snapshot,
        item.hsn_code_snapshot ?? null,
        item.qty,
        item.unit ?? null,
        item.unit_price_snapshot,
        item.gst_rate_snapshot,
        item.price_includes_gst ? 1 : 0,
        item.taxable_value,
        item.gst_amount,
        item.line_total
      );
    }

    // converted_bill_id and converted_at are deliberately absent from this
    // UPDATE: an edit says nothing about whether the offer was accepted.
    await txn.runAsync(
      `UPDATE quotations
          SET customer_name = ?, customer_phone = ?, customer_address = ?,
              subtotal = ?, gst_total = ?, grand_total = ?,
              pdf_path = NULL, edited_at = ?
        WHERE id = ?`,
      input.customer_name.trim(),
      input.customer_phone.trim(),
      input.customer_address?.trim() || null,
      input.subtotal,
      input.gst_total,
      input.grand_total,
      now,
      id
    );
  });

  const updated = await getQuotationById(id, db);
  if (!updated) throw new Error('Quotation was edited but could not be read back.');
  return updated;
}

/** The prior versions of a quotation, newest first. */
export async function listQuotationEdits(
  quotationId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<{ editedAt: string; snapshot: QuotationSnapshot }[]> {
  const rows = await db.getAllAsync<QuotationEditRow>(
    'SELECT * FROM quotation_edits WHERE quotation_id = ? ORDER BY edited_at DESC, id DESC',
    quotationId
  );

  return rows.flatMap((row) => {
    try {
      return [{ editedAt: row.edited_at, snapshot: JSON.parse(row.snapshot) as QuotationSnapshot }];
    } catch {
      return [];
    }
  });
}

/**
 * Deletes a quotation outright, and frees its reference if it was the last one.
 *
 * **A real delete, not the soft one `bills` uses.** The two are opposites on
 * purpose: an invoice number must stay consumed forever, so a bill's row has to
 * survive; a quotation reference is meant to be reusable, and
 * `reference_number` is UNIQUE, so the row has to go for the number to come
 * back. A quotation is an offer that expired, not a tax record.
 *
 * **Only a TRAILING reference is reclaimed.** The counter is reset to the
 * highest reference still in use, so deleting the newest quotation frees its
 * number while deleting an older one leaves its gap. Reusing an arbitrary gap
 * would mean issuing numbers out of order — a reference would stop implying
 * age — and, worse, could hand a customer a Q-0003 when another customer is
 * still holding the PDF of the first Q-0003. The just-issued number is the one
 * least likely to have been sent anywhere, which is why it is the only one
 * taken back.
 *
 * Nothing happens to stock: a quotation never moved any. Nothing happens to a
 * bill it was converted into either — that sale still took place.
 */
export async function deleteQuotation(
  id: number,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const existing = await txn.getFirstAsync<QuotationRow>(
      'SELECT * FROM quotations WHERE id = ?',
      id
    );
    if (!existing) return;

    // quotation_items and quotation_edits both cascade, but being explicit
    // means this still works if a cascade is ever changed.
    await txn.runAsync('DELETE FROM quotation_edits WHERE quotation_id = ?', id);
    await txn.runAsync('DELETE FROM quotation_items WHERE quotation_id = ?', id);
    await txn.runAsync('DELETE FROM quotations WHERE id = ?', id);

    // `Q-` is two characters, so substr(…, 3) is exactly the digits that
    // `renderQuotationNumber` wrote. That function is the only thing that ever
    // produces a reference, which is what makes this safe to parse back.
    const highest = await txn.getFirstAsync<{ top: number | null }>(
      `SELECT MAX(CAST(substr(reference_number, 3) AS INTEGER)) AS top FROM quotations`
    );

    if (highest?.top == null) {
      // Nothing left at all: drop the counter so the next one is Q-0001 again.
      await txn.runAsync('DELETE FROM app_settings WHERE key = ?', SETTING_KEYS.quotationSeq);
      return;
    }

    await txn.runAsync(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      SETTING_KEYS.quotationSeq,
      String(highest.top),
      new Date().toISOString()
    );
  });
}

// ---------------------------------------------------------------------------
// Convert
// ---------------------------------------------------------------------------

/** Raised when a quotation has already become a bill. */
export class AlreadyConvertedError extends Error {
  readonly quotationId: number;

  constructor(quotationId: number) {
    super('This quotation has already been converted into a bill.');
    this.name = 'AlreadyConvertedError';
    this.quotationId = quotationId;
  }
}

/**
 * Turns a quotation into a bill, and records which bill it became.
 *
 * Three things here are load-bearing:
 *
 * **The bill is dated today, never the quotation's date.** The date decides
 * which GST return period the sale falls in. A quotation made in March and
 * accepted in April is an April sale, and inheriting the old date would file it
 * in the wrong quarter — a reporting error, not a cosmetic one.
 *
 * **The whole thing is one transaction.** `createBill` owns its own, and SQLite
 * will not nest, so the quotation is marked through `afterInsert` — the hook
 * that runs inside the bill's transaction. Written as two sequential statements
 * instead, a failure between them would leave a bill nothing points at and a
 * quotation that could be converted a second time.
 *
 * **The guard is in the WHERE clause, not in the caller.** `converted_bill_id
 * IS NULL` with a changes check means two taps racing each other cannot both
 * win: the second finds nothing to update and rolls its bill back. A check in
 * the screen would lose that race and produce two bills from one quotation.
 */
export async function convertQuotationToBill(
  quotationId: number,
  bill: Omit<NewBill, 'afterInsert' | 'date'>,
  db: SQLiteDatabase = getDatabase()
): Promise<{ billId: number }> {
  const existing = await getQuotationById(quotationId, db);
  if (!existing) throw new Error(`Quotation ${quotationId} not found.`);
  // Checked here as well for a clear message before any work is done; the
  // check that actually protects the data is the conditional UPDATE below.
  if (existing.converted_bill_id !== null) throw new AlreadyConvertedError(quotationId);

  const convertedAt = new Date().toISOString();
  let billId = -1;

  await createBill(
    {
      ...bill,
      // Deliberately not the quotation's date. See the note above.
      date: new Date(),
      afterInsert: async (txn, newBillId) => {
        const result = await txn.runAsync(
          `UPDATE quotations
              SET converted_bill_id = ?, converted_at = ?
            WHERE id = ? AND converted_bill_id IS NULL`,
          newBillId,
          convertedAt,
          quotationId
        );

        // Someone else converted it between the read above and this write.
        // Throwing here rolls the bill back, so the race produces one bill.
        if (result.changes === 0) throw new AlreadyConvertedError(quotationId);

        billId = newBillId;
      },
    },
    db
  );

  return { billId };
}

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

/**
 * How old a quotation may get before the prices on it are worth re-checking.
 *
 * Twenty days rather than a month: the owner's suppliers reprice often enough
 * that a quotation carried into a second month is usually stale, and a warning
 * that only appears once something is definitely wrong appears too late.
 */
export const QUOTATION_STALE_DAYS = 20;

/**
 * Whole days between the quotation's date and now, by the calendar rather than
 * by elapsed hours — matching how backup age is counted, so "20 days old" means
 * the same thing everywhere in the app. A future date reads as 0 rather than as
 * a negative age, for a phone whose clock has moved.
 */
export function quotationAgeInDays(date: string, now: Date = new Date()): number {
  const then = new Date(date);
  if (Number.isNaN(then.getTime())) return 0;

  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const days = Math.round((startOfNow.getTime() - startOfThen.getTime()) / 86400000);
  return days > 0 ? days : 0;
}

/** True when an unconverted quotation is old enough that prices may have moved. */
export function isQuotationStale(
  quotation: Pick<QuotationRow, 'date' | 'converted_bill_id'>,
  now: Date = new Date()
): boolean {
  if (quotation.converted_bill_id !== null) return false;
  return quotationAgeInDays(quotation.date, now) >= QUOTATION_STALE_DAYS;
}
