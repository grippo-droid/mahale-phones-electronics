import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from './init';
import { getGlobalLowStockThreshold } from './settings';
import type { ProductRow } from './schema';

/**
 * Product CRUD and search (T1.3).
 *
 * Screens must not query SQLite directly — they call these functions. Technical
 * Architecture Section 9 keeps this seam so cloud sync can be added later
 * without rewriting any UI.
 */

// ---------------------------------------------------------------------------
// Stock status
// ---------------------------------------------------------------------------

/**
 * `negative` is reachable on purpose: billing is allowed to oversell, because a
 * shop's recorded count drifts from the physical shelf and blocking a sale at
 * the counter is worse than a temporarily wrong number. Surfacing it here means
 * the Inventory list can flag it for correction later, not just at billing time.
 */
export type StockStatus = 'negative' | 'out' | 'low' | 'ok';

export type Product = ProductRow & {
  /** The product's own threshold, or the global default when it has none. */
  effectiveLowStockThreshold: number;
  stockStatus: StockStatus;
  /** `price_includes_gst` as a boolean — SQLite stores it as 0/1. */
  priceIncludesGst: boolean;
};

export function deriveStockStatus(stockQty: number, effectiveThreshold: number): StockStatus {
  if (stockQty < 0) return 'negative';
  if (stockQty === 0) return 'out';
  if (stockQty <= effectiveThreshold) return 'low';
  return 'ok';
}

function decorate(row: ProductRow, globalThreshold: number): Product {
  const effectiveLowStockThreshold = row.low_stock_threshold ?? globalThreshold;
  return {
    ...row,
    effectiveLowStockThreshold,
    stockStatus: deriveStockStatus(row.stock_qty, effectiveLowStockThreshold),
    priceIncludesGst: row.price_includes_gst === 1,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type NewProduct = {
  name: string;
  category: string;
  stock_qty: number;
  unit_price: number;
  gst_rate: number;
  hsn_code?: string | null;
  brand?: string | null;
  model_number?: string | null;
  /** NULL/omitted means "use the global default". */
  low_stock_threshold?: number | null;
  /** True when `unit_price` already contains GST. Defaults to false. */
  price_includes_gst?: boolean;
};

export type ProductUpdate = Partial<NewProduct>;

export type ProductListOptions = {
  /** Matches name, brand, model number or HSN code, case-insensitively. */
  search?: string;
  /** Exact category match; omit or pass 'All' for every category. */
  category?: string | null;
  /** Only products at or below their effective threshold (includes out/negative). */
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listProducts(
  options: ProductListOptions = {},
  db: SQLiteDatabase = getDatabase()
): Promise<Product[]> {
  const globalThreshold = await getGlobalLowStockThreshold(db);

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (options.search?.trim()) {
    // Escape LIKE wildcards so a literal % or _ in a search box behaves.
    const term = `%${escapeLike(options.search.trim())}%`;
    where.push(
      `(name LIKE ? ESCAPE '\\' OR IFNULL(brand, '') LIKE ? ESCAPE '\\'` +
        ` OR IFNULL(model_number, '') LIKE ? ESCAPE '\\'` +
        ` OR IFNULL(hsn_code, '') LIKE ? ESCAPE '\\')`
    );
    params.push(term, term, term, term);
  }

  if (options.category && options.category !== 'All') {
    where.push('category = ?');
    params.push(options.category);
  }

  if (options.lowStockOnly) {
    where.push('stock_qty <= COALESCE(low_stock_threshold, ?)');
    params.push(globalThreshold);
  }

  let sql = 'SELECT * FROM products';
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY name COLLATE NOCASE ASC';

  if (options.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(options.limit);
    if (options.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }
  }

  const rows = await db.getAllAsync<ProductRow>(sql, params);
  return rows.map((row) => decorate(row, globalThreshold));
}

export async function getProductById(
  id: number,
  db: SQLiteDatabase = getDatabase()
): Promise<Product | null> {
  const row = await db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE id = ?', id);
  if (!row) return null;
  return decorate(row, await getGlobalLowStockThreshold(db));
}

/** Low-stock count for the Dashboard badge (T5.1). */
export async function countLowStockProducts(
  db: SQLiteDatabase = getDatabase()
): Promise<number> {
  const globalThreshold = await getGlobalLowStockThreshold(db);
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM products WHERE stock_qty <= COALESCE(low_stock_threshold, ?)',
    globalThreshold
  );
  return row?.count ?? 0;
}

export async function countProducts(db: SQLiteDatabase = getDatabase()): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM products');
  return row?.count ?? 0;
}

/** Distinct categories actually in use — for the Inventory filter (T2.1). */
export async function listUsedCategories(
  db: SQLiteDatabase = getDatabase()
): Promise<string[]> {
  const rows = await db.getAllAsync<{ category: string }>(
    'SELECT DISTINCT category FROM products ORDER BY category COLLATE NOCASE ASC'
  );
  return rows.map((row) => row.category);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createProduct(
  input: NewProduct,
  db: SQLiteDatabase = getDatabase()
): Promise<Product> {
  validateProductInput(input);

  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO products
       (name, category, stock_qty, unit_price, gst_rate, hsn_code, brand,
        model_number, low_stock_threshold, price_includes_gst, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.name.trim(),
    input.category,
    input.stock_qty,
    input.unit_price,
    input.gst_rate,
    input.hsn_code?.trim() || null,
    input.brand?.trim() || null,
    input.model_number?.trim() || null,
    input.low_stock_threshold ?? null,
    input.price_includes_gst ? 1 : 0,
    now,
    now
  );

  const created = await getProductById(result.lastInsertRowId, db);
  if (!created) throw new Error('Product was inserted but could not be read back.');
  return created;
}

export async function updateProduct(
  id: number,
  patch: ProductUpdate,
  db: SQLiteDatabase = getDatabase()
): Promise<Product> {
  validateProductInput(patch, { partial: true });

  const columns: string[] = [];
  const params: (string | number | null)[] = [];

  const assign = (column: string, value: string | number | null) => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.name !== undefined) assign('name', patch.name.trim());
  if (patch.category !== undefined) assign('category', patch.category);
  if (patch.stock_qty !== undefined) assign('stock_qty', patch.stock_qty);
  if (patch.unit_price !== undefined) assign('unit_price', patch.unit_price);
  if (patch.gst_rate !== undefined) assign('gst_rate', patch.gst_rate);
  if (patch.hsn_code !== undefined) assign('hsn_code', patch.hsn_code?.trim() || null);
  if (patch.brand !== undefined) assign('brand', patch.brand?.trim() || null);
  if (patch.model_number !== undefined) assign('model_number', patch.model_number?.trim() || null);
  if (patch.low_stock_threshold !== undefined) {
    assign('low_stock_threshold', patch.low_stock_threshold ?? null);
  }
  if (patch.price_includes_gst !== undefined) {
    assign('price_includes_gst', patch.price_includes_gst ? 1 : 0);
  }

  if (columns.length === 0) {
    const unchanged = await getProductById(id, db);
    if (!unchanged) throw new Error(`Product ${id} not found.`);
    return unchanged;
  }

  assign('updated_at', new Date().toISOString());
  params.push(id);

  const result = await db.runAsync(
    `UPDATE products SET ${columns.join(', ')} WHERE id = ?`,
    params
  );
  if (result.changes === 0) throw new Error(`Product ${id} not found.`);

  const updated = await getProductById(id, db);
  if (!updated) throw new Error(`Product ${id} not found after update.`);
  return updated;
}

/**
 * Deletes a product. Past bills are unaffected — `bill_items` keeps its name and
 * price snapshots and its `product_id` becomes NULL (ON DELETE SET NULL), so
 * invoice history stays accurate and reprintable.
 */
export async function deleteProduct(
  id: number,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  const result = await db.runAsync('DELETE FROM products WHERE id = ?', id);
  if (result.changes === 0) throw new Error(`Product ${id} not found.`);
}

/**
 * Applies a relative change to stock — restocking (T2.6) or correcting a count.
 * `delta` may be negative. The result is allowed to go below zero so a correction
 * can never be blocked by a number that is already wrong.
 */
export async function adjustStock(
  id: number,
  delta: number,
  db: SQLiteDatabase = getDatabase()
): Promise<Product> {
  if (!Number.isInteger(delta)) throw new Error('Stock adjustment must be a whole number.');

  const result = await db.runAsync(
    'UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?',
    delta,
    new Date().toISOString(),
    id
  );
  if (result.changes === 0) throw new Error(`Product ${id} not found.`);

  const updated = await getProductById(id, db);
  if (!updated) throw new Error(`Product ${id} not found after stock adjustment.`);
  return updated;
}

/** Sets stock to an absolute figure — a physical stock count. */
export async function setStock(
  id: number,
  quantity: number,
  db: SQLiteDatabase = getDatabase()
): Promise<Product> {
  if (!Number.isInteger(quantity)) throw new Error('Stock quantity must be a whole number.');
  return updateProduct(id, { stock_qty: quantity }, db);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateProductInput(
  input: NewProduct | ProductUpdate,
  { partial = false }: { partial?: boolean } = {}
): void {
  if (!partial || input.name !== undefined) {
    if (!input.name?.trim()) throw new Error('Product name is required.');
  }
  if (!partial || input.category !== undefined) {
    if (!input.category?.trim()) throw new Error('Category is required.');
  }
  if (!partial || input.unit_price !== undefined) {
    if (!Number.isFinite(input.unit_price) || (input.unit_price ?? 0) < 0) {
      throw new Error('Unit price must be zero or more.');
    }
  }
  if (!partial || input.gst_rate !== undefined) {
    if (!Number.isFinite(input.gst_rate) || (input.gst_rate ?? 0) < 0 || (input.gst_rate ?? 0) > 100) {
      throw new Error('GST rate must be between 0 and 100.');
    }
  }
  if (!partial || input.stock_qty !== undefined) {
    if (!Number.isInteger(input.stock_qty)) throw new Error('Stock quantity must be a whole number.');
  }
  if (input.low_stock_threshold !== undefined && input.low_stock_threshold !== null) {
    if (!Number.isInteger(input.low_stock_threshold) || input.low_stock_threshold < 0) {
      throw new Error('Low stock threshold must be a whole number, zero or more.');
    }
  }
}

/** Escapes LIKE metacharacters so a literal % or _ typed into search matches itself. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
