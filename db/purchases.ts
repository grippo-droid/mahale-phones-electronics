import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from '@/db/init';
import { likeClause, likeTerm, LIKE_ESCAPE_SQL } from '@/lib/likeSearch';
import type { PurchaseItemRow, PurchaseRow } from '@/db/schema';

/**
 * What the shop bought, from whom, and for how much (T10.3).
 *
 * The vendor-side mirror of `db/bills.ts`, and shorter than it by everything a
 * tax document needs: no GST split, no invoice number to reserve, no PDF. A
 * purchase is an internal record of money going out.
 */

export type PurchaseWithItems = PurchaseRow & { items: PurchaseItemRow[] };

export type NewPurchaseItem = {
  /** NULL for a one-off line with nothing in Inventory behind it. */
  product_id: number | null;
  product_name_snapshot: string;
  qty: number;
  unit?: string | null;
  cost_price: number;
  line_total: number;
};

export type NewPurchase = {
  vendor_id: number;
  /** The vendor's own bill number, as printed on their paper. */
  vendor_ref?: string | null;
  /** Defaults to now. Stored as an ISO 8601 UTC string. */
  date?: Date;
  total_amount: number;
  notes?: string | null;
  items: NewPurchaseItem[];
  /**
   * Whether to add these quantities to stock.
   *
   * Asked at save time and stored, never inferred. The owner can say no — goods
   * invoiced but not yet delivered, or a purchase being entered after the stock
   * was already counted in by hand — and an edit or a delete afterwards has to
   * know which it was, or it would take away stock that was never added.
   */
  applyStock: boolean;
  /**
   * Product ids whose `purchase_price` should be updated to this purchase's
   * cost. Opt in per line, and empty by default.
   *
   * Deliberately not automatic: `products.purchase_price` is the figure the
   * owner judges a SELLING price against, and one delivery at an unusual rate
   * silently rewriting it would move every margin that reads it. The dialog
   * offers it per line, unticked.
   */
  updateCostFor?: number[];
};

export type PurchaseListOptions = {
  vendorId?: number;
  /** Matches the vendor's bill reference or an item name. */
  search?: string;
  limit?: number;
  offset?: number;
};

/** Children of a purchase, oldest first, as they were entered. */
async function itemsFor(
  purchaseId: number,
  db: SQLiteDatabase
): Promise<PurchaseItemRow[]> {
  return db.getAllAsync<PurchaseItemRow>(
    'SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id ASC',
    purchaseId
  );
}

/** ONE definition of the insert, used by create and edit — the T9.6 lesson. */
async function insertPurchaseItem(
  txn: SQLiteDatabase,
  purchaseId: number,
  item: NewPurchaseItem
): Promise<void> {
  await txn.runAsync(
    `INSERT INTO purchase_items
       (purchase_id, product_id, product_name_snapshot, qty, unit, cost_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    purchaseId,
    item.product_id,
    item.product_name_snapshot,
    item.qty,
    item.unit ?? null,
    item.cost_price,
    item.line_total
  );
}

/** Quantities per product, so a line listing one product twice still adds up. */
function quantitiesByProduct(items: NewPurchaseItem[]): Map<number, number> {
  const byProduct = new Map<number, number>();
  for (const item of items) {
    if (item.product_id === null) continue;
    byProduct.set(item.product_id, (byProduct.get(item.product_id) ?? 0) + item.qty);
  }
  return byProduct;
}

/**
 * Writes a purchase, its lines, and — only if the owner said so — the stock it
 * brought in and the cost prices it updates, as one atomic unit.
 *
 * Stock goes UP here where a bill sends it down. The arithmetic is the same and
 * so is the reason it lives inside the transaction: a crash between the rows
 * and the stock would leave the shop's recorded count disagreeing with a
 * purchase that is sitting right there in the list.
 */
export async function createPurchase(
  input: NewPurchase,
  db: SQLiteDatabase = getDatabase()
): Promise<PurchaseWithItems> {
  if (input.items.length === 0) throw new Error('A purchase needs at least one item.');

  const date = (input.date ?? new Date()).toISOString();
  const now = new Date().toISOString();
  const updateCostFor = new Set(input.updateCostFor ?? []);
  let purchaseId = 0;

  await db.withExclusiveTransactionAsync(async (txn) => {
    const vendor = await txn.getFirstAsync<{ id: number }>(
      'SELECT id FROM vendors WHERE id = ?',
      input.vendor_id
    );
    if (!vendor) throw new Error('That vendor no longer exists.');

    const result = await txn.runAsync(
      `INSERT INTO purchases
         (vendor_id, vendor_ref, date, total_amount, stock_applied, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.vendor_id,
      input.vendor_ref?.trim() || null,
      date,
      input.total_amount,
      input.applyStock ? 1 : 0,
      input.notes?.trim() || null,
      now
    );
    purchaseId = result.lastInsertRowId;

    for (const item of input.items) {
      await insertPurchaseItem(txn, purchaseId, item);

      // Opt-in, per line, and separate from the stock question: one is about
      // how many are on the shelf, the other about what the shop pays for them,
      // and an owner may well want one without the other.
      if (item.product_id !== null && updateCostFor.has(item.product_id)) {
        await txn.runAsync(
          'UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?',
          item.cost_price,
          now,
          item.product_id
        );
      }
    }

    if (input.applyStock) {
      for (const [productId, qty] of quantitiesByProduct(input.items)) {
        await txn.runAsync(
          'UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?',
          qty,
          now,
          productId
        );
      }
    }
  });

  const created = await getPurchaseById(purchaseId, db);
  if (!created) throw new Error('The purchase was saved but could not be read back.');
  return created;
}

export async function getPurchaseById(
  id: number,
  db: SQLiteDatabase = getDatabase()
): Promise<PurchaseWithItems | null> {
  const purchase = await db.getFirstAsync<PurchaseRow>(
    'SELECT * FROM purchases WHERE id = ?',
    id
  );
  if (!purchase) return null;
  return { ...purchase, items: await itemsFor(id, db) };
}

function buildFilter(options: PurchaseListOptions): {
  clause: string;
  params: (string | number)[];
} {
  // Deleted purchases are not things the shop bought, so they leave every list
  // and every total through this one clause — the same reason
  // `buildBillFilter` exists.
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: (string | number)[] = [];

  if (options.vendorId !== undefined) {
    where.push('p.vendor_id = ?');
    params.push(options.vendorId);
  }

  if (options.search?.trim()) {
    const term = likeTerm(options.search);
    // The vendor's reference and their name come through `likeClause`; the item
    // name needs an EXISTS, which is not a column expression, so it spells its
    // own LIKE and takes the escape from `LIKE_ESCAPE_SQL`. Nobody writes that
    // clause by hand here -- it has one definition, and an ESLint rule refuses
    // any other file that tries.
    const columns = ["IFNULL(p.vendor_ref, '')", 'v.name'];
    where.push(
      `(${likeClause(columns)} OR EXISTS (
          SELECT 1 FROM purchase_items pi
           WHERE pi.purchase_id = p.id
             AND pi.product_name_snapshot LIKE ? ${LIKE_ESCAPE_SQL}))`
    );
    // One bound copy per expression, in the order they appear.
    params.push(term, term, term);
  }

  return { clause: ` WHERE ${where.join(' AND ')}`, params };
}

/** Purchase headers, newest first. */
export async function listPurchases(
  options: PurchaseListOptions = {},
  db: SQLiteDatabase = getDatabase()
): Promise<PurchaseRow[]> {
  const { clause, params } = buildFilter(options);

  let sql = `SELECT p.* FROM purchases p
               JOIN vendors v ON v.id = p.vendor_id
             ${clause}
             ORDER BY p.date DESC, p.id DESC`;

  if (options.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(options.limit);
    if (options.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }
  }

  return db.getAllAsync<PurchaseRow>(sql, params);
}

/**
 * Removes a purchase, and asks whether its stock should go back.
 *
 * Soft, like a bill's: a part-paid purchase carries a ledger, and a hard delete
 * would cascade that away — destroying the record of money that actually left
 * the shop while the vendor's rollup silently changed.
 *
 * `reverseStock` is only honoured when the purchase actually moved stock. A
 * purchase saved without applying it has nothing to take back, and taking it
 * anyway would remove goods the shop never recorded receiving.
 */
export async function deletePurchase(
  id: number,
  options: { reverseStock: boolean },
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    const purchase = await txn.getFirstAsync<PurchaseRow>(
      'SELECT * FROM purchases WHERE id = ?',
      id
    );
    if (!purchase) throw new Error(`Purchase ${id} not found.`);
    // Deleting twice is a no-op, so stock cannot be taken back twice.
    if (purchase.deleted_at !== null) return;

    if (options.reverseStock && purchase.stock_applied === 1) {
      const items = await txn.getAllAsync<PurchaseItemRow>(
        'SELECT * FROM purchase_items WHERE purchase_id = ?',
        id
      );
      for (const item of items) {
        if (item.product_id === null) continue;
        await txn.runAsync(
          'UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?',
          item.qty,
          now,
          item.product_id
        );
      }
    }

    await txn.runAsync('UPDATE purchases SET deleted_at = ? WHERE id = ?', now, id);
  });
}

export async function countPurchases(db: SQLiteDatabase = getDatabase()): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM purchases WHERE deleted_at IS NULL'
  );
  return row?.count ?? 0;
}
