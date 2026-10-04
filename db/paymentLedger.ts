import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * The ledger CRUD shared by every table that records money arriving in
 * instalments.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `bill_payments` was the only such table, so its four writes lived in
 * `db/payments.ts`. A second one — purchases, where the shop owes a vendor —
 * has exactly the same shape: one row per payment, a running balance, a status
 * computed from the rows and never stored.
 *
 * Copying the four writes would be copying the fiddly parts: the newest-first
 * ordering that has to agree between the single and batched reads, the
 * `COALESCE(paid_on, created_at)` that keeps undated rows in a sensible place,
 * and `edited_at` being set on correction but not on insert. This codebase has
 * already shipped the same bug twice from exactly that kind of duplication —
 * the `ESCAPE` clause — and lost a discount on edit because one of two
 * identical inserts gained a column and the other did not.
 *
 * **What is deliberately NOT here: the PDF rule.** Every write to a bill's
 * ledger must clear `bills.pdf_path`, because the stored invoice prints the
 * payments and a stale one would be reshared under the same invoice number. A
 * purchase has no PDF and never will, so that rule is true of one caller and
 * meaningless to the other. It stays in `db/payments.ts`, visible beside the
 * writes it governs, rather than becoming a hook here that is null half the
 * time.
 *
 * That is also why the write functions take and return plain ids rather than
 * accepting a callback: the caller keeps its own ordering and its own
 * after-effects, and this module stays a thing that only moves rows.
 * ---------------------------------------------------------------------------
 */

/** One payment, as every ledger stores it. The owner's id is aliased on read. */
export type LedgerPayment = {
  id: number;
  /** The bill or purchase this belongs to. Named generically; see `LedgerSpec`. */
  owner_id: number;
  amount: number;
  /**
   * ISO date, or NULL where it was never recorded — the rows migration 010
   * created from bills already marked paid. A ledger shows "Date not recorded"
   * for those rather than inventing one.
   */
  paid_on: string | null;
  note: string | null;
  created_at: string;
  edited_at: string | null;
};

export type NewLedgerPayment = {
  amount: number;
  paid_on: string | null;
  note?: string | null;
};

/** Which table, and the column naming its owner. */
export type LedgerSpec = {
  table: string;
  ownerColumn: string;
};

/**
 * Both names are interpolated into SQL, so they are checked rather than
 * trusted.
 *
 * They are module constants today and can only become anything else by someone
 * routing a value here from outside. That is exactly the change nobody would
 * notice, and the cost of refusing it is one regex.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parts(spec: LedgerSpec): { table: string; owner: string } {
  if (!IDENTIFIER.test(spec.table) || !IDENTIFIER.test(spec.ownerColumn)) {
    throw new Error('A ledger table and owner column must be plain SQL identifiers.');
  }
  return { table: spec.table, owner: spec.ownerColumn };
}

/**
 * The columns every read returns, with the owner's column aliased.
 *
 * One definition, so the single read and the batched read cannot drift in
 * their ordering — which they would show as a ledger whose newest entry moves
 * depending on which screen opened it.
 */
function selection(spec: LedgerSpec): { columns: string; order: string; table: string; owner: string } {
  const { table, owner } = parts(spec);
  return {
    table,
    owner,
    columns: `id, ${owner} AS owner_id, amount, paid_on, note, created_at, edited_at`,
    // Newest first: the instalment being looked for is nearly always the last
    // one. `paid_on` falls back to `created_at` so an undated row sorts by when
    // it was entered rather than dropping to the bottom.
    order: 'ORDER BY COALESCE(paid_on, created_at) DESC, id DESC',
  };
}

export async function listLedgerPayments(
  spec: LedgerSpec,
  ownerId: number,
  db: SQLiteDatabase
): Promise<LedgerPayment[]> {
  const { columns, order, table, owner } = selection(spec);
  return db.getAllAsync<LedgerPayment>(
    `SELECT ${columns} FROM ${table} WHERE ${owner} = ? ${order}`,
    ownerId
  );
}

/**
 * The ledgers for several owners at once, keyed by owner id.
 *
 * One query rather than one per row: a list screen draws a status on every row,
 * and the alternative puts the page size into the query count.
 */
export async function listLedgerPaymentsForOwners(
  spec: LedgerSpec,
  ownerIds: number[],
  db: SQLiteDatabase
): Promise<Map<number, LedgerPayment[]>> {
  const byOwner = new Map<number, LedgerPayment[]>();
  if (ownerIds.length === 0) return byOwner;

  const { columns, order, table, owner } = selection(spec);
  const placeholders = ownerIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<LedgerPayment>(
    `SELECT ${columns} FROM ${table} WHERE ${owner} IN (${placeholders}) ${order}`,
    ...ownerIds
  );

  for (const row of rows) {
    const bucket = byOwner.get(row.owner_id) ?? [];
    bucket.push(row);
    byOwner.set(row.owner_id, bucket);
  }
  return byOwner;
}

/**
 * Which owner an entry belongs to.
 *
 * Separate from the write so a caller can do its own work BEFORE the row
 * changes — `db/payments.ts` clears the bill's stored PDF first, and that
 * ordering is what stops a write succeeding against a bill that has since been
 * deleted.
 */
export async function ownerIdFor(
  spec: LedgerSpec,
  paymentId: number,
  db: SQLiteDatabase
): Promise<number> {
  const { table, owner } = parts(spec);
  const row = await db.getFirstAsync<{ owner_id: number }>(
    `SELECT ${owner} AS owner_id FROM ${table} WHERE id = ?`,
    paymentId
  );
  if (!row) throw new Error(`Payment ${paymentId} not found.`);
  return row.owner_id;
}

export async function insertLedgerPayment(
  spec: LedgerSpec,
  ownerId: number,
  payment: NewLedgerPayment,
  db: SQLiteDatabase
): Promise<void> {
  const { table, owner } = parts(spec);
  await db.runAsync(
    `INSERT INTO ${table} (${owner}, amount, paid_on, note, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    ownerId,
    payment.amount,
    payment.paid_on,
    payment.note ?? null,
    new Date().toISOString()
  );
}

/**
 * Corrects an entry in place.
 *
 * A correction rather than a reversing entry: the owner is fixing a figure they
 * mistyped a minute ago, not keeping double-entry books, and a ledger that
 * grows a correction line per slip is unreadable on a phone. `edited_at`
 * records that it happened, and stays NULL until the first correction so
 * "never touched" and "edited back to the same figure" remain distinguishable.
 */
export async function updateLedgerPayment(
  spec: LedgerSpec,
  paymentId: number,
  payment: NewLedgerPayment,
  db: SQLiteDatabase
): Promise<void> {
  const { table } = parts(spec);
  await db.runAsync(
    `UPDATE ${table}
        SET amount = ?, paid_on = ?, note = ?, edited_at = ?
      WHERE id = ?`,
    payment.amount,
    payment.paid_on,
    payment.note ?? null,
    new Date().toISOString(),
    paymentId
  );
}

export async function removeLedgerPayment(
  spec: LedgerSpec,
  paymentId: number,
  db: SQLiteDatabase
): Promise<void> {
  const { table } = parts(spec);
  await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, paymentId);
}
