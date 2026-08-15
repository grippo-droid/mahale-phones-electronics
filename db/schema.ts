import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Table definitions and versioned migrations.
 *
 * Schema follows PRD Section 7. Versioning follows Technical Architecture
 * Section 3: a `schema_version` table plus numbered migration scripts, so future
 * schema changes never require reinstalling the app or wiping the shop's data.
 *
 * Rules for changing the schema:
 *   - NEVER edit a migration that has already shipped. The owner's phone has
 *     already run it; editing it means their database and the code disagree.
 *   - Add a new numbered entry to MIGRATIONS instead. Migrations run in order,
 *     each inside a transaction, and each is recorded in `schema_version`.
 */

export const DATABASE_NAME = 'mahale.db';

/**
 * Product categories (PRD 6.1).
 *
 * Presented as a fixed dropdown rather than free text: a typo like "cctv" beside
 * "CCTV" would silently split a category in two, and that is tedious to clean up
 * on a phone. Category is stored as TEXT, so adding an entry here needs no
 * migration — existing products keep whatever value they already hold.
 */
export const PRODUCT_CATEGORIES = [
  'CCTV',
  'RO',
  'Tube Light',
  'Bulb',
  'Wiring & Electrical',
  'Other',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Standard Indian GST slabs (Frontend Spec 2.3). */
export const GST_RATE_SLABS = [0, 5, 12, 18, 28] as const;

// ---------------------------------------------------------------------------
// Row types — these mirror the columns exactly, snake_case included, because
// they are what SQLite hands back.
// ---------------------------------------------------------------------------

export type ProductRow = {
  id: number;
  name: string;
  category: string;
  stock_qty: number;
  unit_price: number;
  gst_rate: number;
  hsn_code: string | null;
  brand: string | null;
  model_number: string | null;
  /** NULL means "fall back to the global default in app_settings". */
  low_stock_threshold: number | null;
  created_at: string;
  updated_at: string;
};

export type BillRow = {
  id: number;
  invoice_number: string;
  date: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_gstin: string | null;
  customer_state: string;
  subtotal: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  grand_total: number;
  pdf_path: string | null;
  created_at: string;
};

export type BillItemRow = {
  id: number;
  bill_id: number;
  /** NULL if the product was deleted after this bill was raised. */
  product_id: number | null;
  product_name_snapshot: string;
  hsn_code_snapshot: string | null;
  qty: number;
  unit_price_snapshot: number;
  gst_rate_snapshot: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
};

export type SchemaVersionRow = {
  version: number;
  name: string;
  applied_at: string;
};

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export type Migration = {
  version: number;
  name: string;
  up: (db: SQLiteDatabase) => Promise<void>;
};

const migration001: Migration = {
  version: 1,
  name: 'initial_schema',
  up: async (db) => {
    await db.execAsync(`
      CREATE TABLE products (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        name                TEXT    NOT NULL,
        category            TEXT    NOT NULL,
        stock_qty           INTEGER NOT NULL DEFAULT 0,
        unit_price          REAL    NOT NULL,
        gst_rate            REAL    NOT NULL DEFAULT 0,
        hsn_code            TEXT,
        brand               TEXT,
        model_number        TEXT,
        low_stock_threshold INTEGER,
        created_at          TEXT    NOT NULL,
        updated_at          TEXT    NOT NULL
      );

      CREATE INDEX idx_products_name     ON products (name);
      CREATE INDEX idx_products_category ON products (category);

      CREATE TABLE bills (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number   TEXT    NOT NULL UNIQUE,
        date             TEXT    NOT NULL,
        customer_name    TEXT    NOT NULL,
        customer_phone   TEXT    NOT NULL,
        customer_address TEXT,
        customer_gstin   TEXT,
        customer_state   TEXT    NOT NULL,
        subtotal         REAL    NOT NULL DEFAULT 0,
        cgst_total       REAL    NOT NULL DEFAULT 0,
        sgst_total       REAL    NOT NULL DEFAULT 0,
        igst_total       REAL    NOT NULL DEFAULT 0,
        grand_total      REAL    NOT NULL DEFAULT 0,
        pdf_path         TEXT,
        created_at       TEXT    NOT NULL
      );

      CREATE INDEX        idx_bills_date           ON bills (date DESC);
      CREATE UNIQUE INDEX idx_bills_invoice_number ON bills (invoice_number);
      CREATE INDEX        idx_bills_customer_phone ON bills (customer_phone);

      CREATE TABLE bill_items (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id               INTEGER NOT NULL REFERENCES bills (id)    ON DELETE CASCADE,
        product_id            INTEGER          REFERENCES products (id) ON DELETE SET NULL,
        product_name_snapshot TEXT    NOT NULL,
        hsn_code_snapshot     TEXT,
        qty                   INTEGER NOT NULL,
        unit_price_snapshot   REAL    NOT NULL,
        gst_rate_snapshot     REAL    NOT NULL DEFAULT 0,
        taxable_value         REAL    NOT NULL DEFAULT 0,
        cgst_amount           REAL    NOT NULL DEFAULT 0,
        sgst_amount           REAL    NOT NULL DEFAULT 0,
        igst_amount           REAL    NOT NULL DEFAULT 0,
        line_total            REAL    NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_bill_items_bill_id ON bill_items (bill_id);

      CREATE TABLE app_settings (
        key        TEXT PRIMARY KEY NOT NULL,
        value      TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  },
};

/**
 * Every migration ever shipped, in order. Append only.
 */
export const MIGRATIONS: Migration[] = [migration001];

/** The schema version the current build of the app expects. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0
);
