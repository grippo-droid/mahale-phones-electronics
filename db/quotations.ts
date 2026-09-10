import type { SQLiteDatabase } from 'expo-sqlite';

import { createBill, type NewBill, type NewBillItem } from './bills';
import { getDatabase } from './init';
import type { QuotationItemRow, QuotationRow } from './schema';
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

/**
 * The LIKE escape character, exactly as in `db/bills.ts`.
 *
 * The TypeScript literal is two characters and the runtime value is ONE
 * backslash, which is what the SQL needs. Interpolating it twice renders two
 * characters and SQLite rejects the entire query — "ESCAPE expression must be a
 * single character". This project already shipped that bug once in
 * `db/bills.ts`, where nothing noticed until a search box was finally wired up;
 * it was reintroduced here and caught by the test that searches by reference.
 *
 * One constant, used by both the SQL and `escapeLike`, so the two cannot
 * disagree about which character is doing the escaping.
 */
const LIKE_ESCAPE = '\\';

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `${LIKE_ESCAPE}${match}`);
}

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
    const term = `%${escapeLike(options.search.trim())}%`;
    where.push(
      `(customer_name LIKE ? ESCAPE '${LIKE_ESCAPE}'` +
        ` OR customer_phone LIKE ? ESCAPE '${LIKE_ESCAPE}'` +
        ` OR reference_number LIKE ? ESCAPE '${LIKE_ESCAPE}')`
    );
    params.push(term, term, term);
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
