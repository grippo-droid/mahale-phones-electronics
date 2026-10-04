import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '@/db/init';
import { likeClause, likeTerm } from '@/lib/likeSearch';
import { vendorTotals, type VendorTotals } from '@/lib/purchase';
import type { VendorRow } from '@/db/schema';

/**
 * The shops and suppliers this shop buys from (T10.3).
 *
 * A normalised table rather than a name typed onto each purchase, which is the
 * opposite of how a CUSTOMER is stored — and deliberately so. A customer is a
 * walk-in the shop may never see again, so `bills` carries their name as text
 * and the address book fills it in. A vendor is a standing relationship with a
 * running balance; "what do I owe Sharma Electronics" is the question this
 * feature exists to answer, and it cannot be asked of free text where one
 * vendor is spelled three ways.
 */

export type NewVendor = {
  name: string;
  phone?: string | null;
  notes?: string | null;
};

export type VendorWithTotals = VendorRow & VendorTotals;

export async function listVendors(
  search: string | undefined,
  db: SQLiteDatabase = getDatabase()
): Promise<VendorRow[]> {
  if (!search?.trim()) {
    return db.getAllAsync<VendorRow>('SELECT * FROM vendors ORDER BY name COLLATE NOCASE');
  }
  const columns = ['name', "IFNULL(phone, '')"];
  const term = likeTerm(search);
  return db.getAllAsync<VendorRow>(
    `SELECT * FROM vendors WHERE ${likeClause(columns)} ORDER BY name COLLATE NOCASE`,
    ...columns.map(() => term)
  );
}

export async function getVendorById(
  id: number,
  db: SQLiteDatabase = getDatabase()
): Promise<VendorRow | null> {
  return db.getFirstAsync<VendorRow>('SELECT * FROM vendors WHERE id = ?', id);
}

export async function createVendor(
  vendor: NewVendor,
  db: SQLiteDatabase = getDatabase()
): Promise<VendorRow> {
  const name = vendor.name.trim();
  if (name === '') throw new Error('A vendor needs a name.');

  const result = await db.runAsync(
    'INSERT INTO vendors (name, phone, notes, created_at) VALUES (?, ?, ?, ?)',
    name,
    vendor.phone?.trim() || null,
    vendor.notes?.trim() || null,
    new Date().toISOString()
  );

  const created = await getVendorById(result.lastInsertRowId, db);
  if (!created) throw new Error('The vendor was saved but could not be read back.');
  return created;
}

export async function updateVendor(
  id: number,
  vendor: NewVendor,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  const name = vendor.name.trim();
  if (name === '') throw new Error('A vendor needs a name.');

  const result = await db.runAsync(
    'UPDATE vendors SET name = ?, phone = ?, notes = ? WHERE id = ?',
    name,
    vendor.phone?.trim() || null,
    vendor.notes?.trim() || null,
    id
  );
  if (result.changes === 0) throw new Error(`Vendor ${id} not found.`);
}

/**
 * A vendor can only be removed once nothing points at it.
 *
 * `purchases.vendor_id` has no cascade on purpose: deleting a vendor must not
 * take the record of what was bought and paid with it. Refusing is the honest
 * answer, and the screen says how many purchases are in the way rather than
 * failing with a constraint error.
 */
export async function countPurchasesFor(
  vendorId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM purchases WHERE vendor_id = ? AND deleted_at IS NULL',
    vendorId
  );
  return row?.count ?? 0;
}

export async function deleteVendor(
  id: number,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  const inUse = await countPurchasesFor(id, db);
  if (inUse > 0) {
    throw new Error(
      `This vendor has ${inUse} ${inUse === 1 ? 'purchase' : 'purchases'} recorded against them, so they cannot be removed.`
    );
  }
  const result = await db.runAsync('DELETE FROM vendors WHERE id = ?', id);
  if (result.changes === 0) throw new Error(`Vendor ${id} not found.`);
}

/**
 * Every vendor with what they have been bought from, paid, and are still owed.
 *
 * ---------------------------------------------------------------------------
 * The aggregate is fetched per purchase and summed in TypeScript rather than
 * being a single `SUM()` across the join, and that is the same decision as
 * `listOutstandingCandidates`:
 *
 *   - Two joins to two child tables would multiply rows against each other —
 *     a purchase with three items and two payments produces six rows, and the
 *     totals come out triple-counted. Avoiding that needs subqueries anyway.
 *   - Money is compared in whole paise, and `vendorTotals` is the one place
 *     that arithmetic lives. Letting SQLite sum REAL rupees here would give it
 *     a second definition, free to disagree.
 *
 * What is owed is clamped per purchase, never netted across them: overpaying
 * one vendor bill does not reduce what is owed on another, and netting would
 * hide a debt behind a credit the vendor has not agreed to offset.
 * ---------------------------------------------------------------------------
 */
export async function listVendorsWithTotals(
  search: string | undefined,
  db: SQLiteDatabase = getDatabase()
): Promise<VendorWithTotals[]> {
  const vendors = await listVendors(search, db);
  if (vendors.length === 0) return [];

  const rows = await db.getAllAsync<{
    vendor_id: number;
    total_amount: number;
    paid_amount: number;
  }>(
    `SELECT p.vendor_id,
            p.total_amount,
            COALESCE((SELECT SUM(pp.amount)
                        FROM purchase_payments pp
                       WHERE pp.purchase_id = p.id), 0) AS paid_amount
       FROM purchases p
      WHERE p.deleted_at IS NULL`
  );

  const byVendor = new Map<number, { total_amount: number; paidAmount: number }[]>();
  for (const row of rows) {
    const bucket = byVendor.get(row.vendor_id) ?? [];
    bucket.push({ total_amount: row.total_amount, paidAmount: row.paid_amount });
    byVendor.set(row.vendor_id, bucket);
  }

  return vendors.map((vendor) => ({
    ...vendor,
    ...vendorTotals(byVendor.get(vendor.id) ?? []),
  }));
}

/** The same rollup for one vendor, for their own screen. */
export async function getVendorTotals(
  vendorId: number,
  db: SQLiteDatabase = getDatabase()
): Promise<VendorTotals> {
  const rows = await db.getAllAsync<{ total_amount: number; paid_amount: number }>(
    `SELECT p.total_amount,
            COALESCE((SELECT SUM(pp.amount)
                        FROM purchase_payments pp
                       WHERE pp.purchase_id = p.id), 0) AS paid_amount
       FROM purchases p
      WHERE p.vendor_id = ? AND p.deleted_at IS NULL`,
    vendorId
  );
  return vendorTotals(
    rows.map((row) => ({ total_amount: row.total_amount, paidAmount: row.paid_amount }))
  );
}

/** What the shop owes every vendor put together, for the Dashboard card. */
export async function totalOwedToVendors(
  db: SQLiteDatabase = getDatabase()
): Promise<number> {
  const all = await listVendorsWithTotals(undefined, db);
  return Math.round(all.reduce((sum, vendor) => sum + vendor.owed * 100, 0)) / 100;
}
