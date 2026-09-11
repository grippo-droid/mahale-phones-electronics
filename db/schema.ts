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
  /**
   * SQLite has no boolean: 1 = `unit_price` already contains GST (the customer
   * pays exactly that), 0 = GST is added on top. Set per product because a shop
   * quotes MRP-inclusive prices on some lines and pre-tax prices on others.
   */
  price_includes_gst: number;
  /**
   * What the shop paid for one unit. NULL when it was not recorded — stock is
   * sometimes added without the cost to hand.
   *
   * INTERNAL ONLY. This must never reach a customer: not on a bill, an invoice
   * PDF, a thermal print, or anything shared out of the app. `bill_items` has no
   * corresponding column by design, so a bill has nowhere to carry it.
   */
  purchase_price: number | null;
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
  /**
   * The adjustment that took the exact total to a whole rupee. Stored rather
   * than recomputed because it is a printed line on the invoice: the bill must
   * be reproducible years later even if the rounding rule ever changes.
   */
  round_off: number;
  grand_total: number;
  pdf_path: string | null;
  /**
   * How the sale was settled — see `lib/payment.ts`. NULL on every bill raised
   * before migration 006, where it was never recorded.
   */
  payment_type: string | null;
  /**
   * When the bill was deleted, or NULL while it is live (migration 008).
   *
   * Soft, so the invoice number stays consumed — reissuing it would hand two
   * customers the same number, which is worse than the gap a deletion leaves.
   * Every read that means "the shop's sales" must exclude these; the one that
   * must NOT is `invoiceNumberExists`, which exists to stop reuse.
   */
  deleted_at: string | null;
  /** When the bill was last edited, or NULL if it never has been. */
  edited_at: string | null;
  /**
   * 1 paid, 0 not paid, NULL not recorded. Deliberately independent of
   * `payment_type`: a credit bill gets paid later and a cash bill can go out
   * unpaid, so one does not determine the other. It only supplies the default.
   */
  paid: number | null;
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
  /**
   * How the quantity is measured — see `lib/units.ts`. NULL on every bill
   * raised before migration 005, and on any line where none was chosen.
   */
  unit: string | null;
  unit_price_snapshot: number;
  gst_rate_snapshot: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
};

export type QuotationRow = {
  id: number;
  /** Q-0001, Q-0002 … Its own series, unrelated to invoice numbers. */
  reference_number: string;
  date: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  subtotal: number;
  /**
   * One GST figure, not a CGST/SGST/IGST split. Which heads apply is decided by
   * the customer's state when the sale happens, and a quotation does not ask
   * for it — so a split here would be an invented one.
   */
  gst_total: number;
  grand_total: number;
  pdf_path: string | null;
  /**
   * The bill this quotation became, or NULL if it has not been converted. The
   * only record of that fact: a separate "converted" flag would be a second
   * copy of it, free to disagree with the link.
   */
  converted_bill_id: number | null;
  converted_at: string | null;
  /** When the quotation was last edited, or NULL if it never has been. */
  edited_at: string | null;
  created_at: string;
};

export type QuotationItemRow = {
  id: number;
  quotation_id: number;
  /** NULL if the product was deleted after the quotation was made. */
  product_id: number | null;
  product_name_snapshot: string;
  hsn_code_snapshot: string | null;
  qty: number;
  /** One of `lib/units.ts`, or NULL when none was chosen. */
  unit: string | null;
  unit_price_snapshot: number;
  gst_rate_snapshot: number;
  /** Kept so converting rebuilds the cart line exactly as it was quoted. */
  price_includes_gst: number;
  taxable_value: number;
  gst_amount: number;
  line_total: number;
};

/** One prior version of a quotation, kept when it is edited (migration 009). */
export type QuotationEditRow = {
  id: number;
  quotation_id: number;
  edited_at: string;
  /** JSON: the quotation's totals and lines as they stood before this edit. */
  snapshot: string;
};

/** One prior version of a bill, kept when it is edited (migration 008). */
export type BillEditRow = {
  id: number;
  bill_id: number;
  edited_at: string;
  /** JSON: the bill's totals and lines as they stood before this edit. */
  snapshot: string;
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

const migration002: Migration = {
  version: 2,
  name: 'product_price_includes_gst',
  up: async (db) => {
    // Defaults to 0 (GST added on top) so every product that existed before this
    // column is treated exactly as it was calculated previously.
    await db.execAsync(`
      ALTER TABLE products ADD COLUMN price_includes_gst INTEGER NOT NULL DEFAULT 0;
    `);
  },
};

const migration003: Migration = {
  version: 3,
  name: 'product_purchase_price',
  up: async (db) => {
    // Nullable with no default: "not recorded" and "cost was zero" are different
    // statements, and only NULL can say the first one.
    await db.execAsync(`
      ALTER TABLE products ADD COLUMN purchase_price REAL;
    `);
  },
};

const migration004: Migration = {
  version: 4,
  name: 'bill_round_off',
  up: async (db) => {
    // Defaults to 0, which is correct for every bill written before this column
    // existed: those totals were stored unrounded, so nothing was adjusted.
    await db.execAsync(`
      ALTER TABLE bills ADD COLUMN round_off REAL NOT NULL DEFAULT 0;
    `);
  },
};

const migration005: Migration = {
  version: 5,
  name: 'bill_item_unit',
  up: async (db) => {
    // Nullable with no default, and no backfill. Every bill raised before this
    // column existed was raised without a unit being chosen, and that is what
    // NULL says. A default of 'Pieces' would print a claim on those invoices
    // that nobody made when the sale happened.
    await db.execAsync(`
      ALTER TABLE bill_items ADD COLUMN unit TEXT;
    `);
  },
};

const migration006: Migration = {
  version: 6,
  name: 'bill_payment',
  up: async (db) => {
    // Both nullable with no default, and no backfill, for the same reason as
    // migration 005: a bill raised before these columns existed recorded no
    // payment type and no paid status, and NULL is the only value that says so.
    // Defaulting the old bills to Cash/Paid would be inventing a fact about
    // money, which is the worst kind to invent.
    await db.execAsync(`
      ALTER TABLE bills ADD COLUMN payment_type TEXT;
      ALTER TABLE bills ADD COLUMN paid INTEGER;
    `);
  },
};

const migration007: Migration = {
  version: 7,
  name: 'quotations',
  up: async (db) => {
    // A quotation is an offer, not a legal document, which is why this looks
    // like `bills` but is not it: no invoice number, no CGST/SGST/IGST split
    // (the split is decided by the customer's state at the time of sale, which
    // a quotation does not collect), no GSTIN, and no effect on stock.
    //
    // `converted_bill_id` NULL means "not converted", and is the single source
    // of truth for that — a separate boolean would be a second record of the
    // same fact, free to disagree with the link.
    await db.execAsync(`
      CREATE TABLE quotations (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        reference_number  TEXT    NOT NULL UNIQUE,
        date              TEXT    NOT NULL,
        customer_name     TEXT    NOT NULL,
        customer_phone    TEXT    NOT NULL,
        customer_address  TEXT,
        subtotal          REAL    NOT NULL DEFAULT 0,
        gst_total         REAL    NOT NULL DEFAULT 0,
        grand_total       REAL    NOT NULL DEFAULT 0,
        pdf_path          TEXT,
        converted_bill_id INTEGER REFERENCES bills (id) ON DELETE SET NULL,
        converted_at      TEXT,
        created_at        TEXT    NOT NULL
      );

      CREATE INDEX        idx_quotations_date      ON quotations (date DESC);
      CREATE UNIQUE INDEX idx_quotations_reference ON quotations (reference_number);

      CREATE TABLE quotation_items (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id          INTEGER NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
        product_id            INTEGER          REFERENCES products (id)   ON DELETE SET NULL,
        product_name_snapshot TEXT    NOT NULL,
        hsn_code_snapshot     TEXT,
        qty                   INTEGER NOT NULL,
        unit                  TEXT,
        unit_price_snapshot   REAL    NOT NULL,
        gst_rate_snapshot     REAL    NOT NULL DEFAULT 0,
        price_includes_gst    INTEGER NOT NULL DEFAULT 0,
        taxable_value         REAL    NOT NULL DEFAULT 0,
        gst_amount            REAL    NOT NULL DEFAULT 0,
        line_total            REAL    NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_quotation_items_quotation_id ON quotation_items (quotation_id);
    `);
  },
};

const migration008: Migration = {
  version: 8,
  name: 'bill_edit_and_delete',
  up: async (db) => {
    // `deleted_at` NULL means the bill is live. A soft delete rather than a
    // real one, because the invoice number must stay consumed: reissuing it
    // would hand two customers the same number, which is worse than the gap a
    // deletion leaves in the sequence. It also keeps the record if the customer
    // turns up months later holding the printed copy.
    //
    // `edited_at` is NULL until the first edit, so "never touched" and "edited
    // and happens to match" stay distinguishable.
    await db.execAsync(`
      ALTER TABLE bills ADD COLUMN deleted_at TEXT;
      ALTER TABLE bills ADD COLUMN edited_at  TEXT;

      -- (deleted_at, date) and NOT (deleted_at) alone.
      --
      -- An index on deleted_at by itself is nearly useless — it is NULL for
      -- almost every row — but SQLite will still pick it for the equality test
      -- and then walk every live bill. That is exactly what it did here, and it
      -- undid T7.5: "frequently sold" went back to costing the shop's entire
      -- history instead of the 90 days it reads. With date as the second column
      -- the same index satisfies the equality AND the date range, so the
      -- windowed query still reads only the window.
      CREATE INDEX idx_bills_live_date ON bills (deleted_at, date DESC);

      CREATE TABLE bill_edits (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id    INTEGER NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
        edited_at  TEXT    NOT NULL,
        /**
         * The bill as it stood BEFORE this edit, as JSON: its totals and its
         * lines. A snapshot rather than normalised rows on purpose — it is
         * never queried, only read back whole if a dispute comes up, and a
         * second copy of bill_items would have to be migrated forward forever
         * alongside the real one.
         */
        snapshot   TEXT    NOT NULL
      );

      CREATE INDEX idx_bill_edits_bill_id ON bill_edits (bill_id);
    `);
  },
};

const migration009: Migration = {
  version: 9,
  name: 'quotation_edit',
  up: async (db) => {
    // Only an edit trail. There is no `deleted_at` here, unlike `bills`:
    // deleting a quotation is a real delete, because its reference number has
    // to be free to reuse and `reference_number` is UNIQUE. That is the exact
    // opposite of a bill, whose number must stay consumed forever — and the
    // reason the two differ is that a quotation is an offer, not a tax record.
    await db.execAsync(`
      ALTER TABLE quotations ADD COLUMN edited_at TEXT;

      CREATE TABLE quotation_edits (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id INTEGER NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
        edited_at    TEXT    NOT NULL,
        snapshot     TEXT    NOT NULL
      );

      CREATE INDEX idx_quotation_edits_quotation_id ON quotation_edits (quotation_id);
    `);
  },
};

const migration010: Migration = {
  version: 10,
  name: 'bill_payments',
  up: async (db) => {
    // A bill is settled by a LEDGER of payments, not by a flag. A customer
    // paying half now and half next week is ordinary, and `bills.paid` could
    // not say so — it had two states for a situation with three.
    //
    // `paid_on` is NULLABLE, and that is the whole of what this migration knows
    // and does not know. A bill already marked paid records a real fact the
    // owner entered: it was settled, in full. The AMOUNT is therefore knowable
    // (the grand total) but the DATE was never recorded anywhere, and inventing
    // one would put a date on a customer's reprinted invoice that nobody ever
    // entered. NULL means "recorded before this ledger existed"; the PDF prints
    // the amount for those rows and leaves the date column empty.
    //
    // Nothing is backfilled for `paid = 0` or `paid IS NULL`. NULL has always
    // meant "never recorded" here, and turning it into a zero-payment ledger
    // would be the same invention in the other direction.
    //
    // `bills.paid` is deliberately left in place and stops being read. It is
    // not a second source of truth once nothing consults it, and keeping the
    // column means an older backup restores into this schema unchanged and is
    // then migrated forward by exactly this step.
    await db.execAsync(`
      CREATE TABLE bill_payments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id    INTEGER NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
        /* Rupees. Stored as REAL like every other money column here, but
           compared in whole paise -- see lib/payment.ts. */
        amount     REAL    NOT NULL,
        /* ISO date. NULL only for rows this migration created. */
        paid_on    TEXT,
        note       TEXT,
        created_at TEXT    NOT NULL,
        /* NULL until the entry is first corrected, so "never touched" and
           "edited back to the same figure" stay distinguishable -- the same
           reason bills.edited_at is nullable. */
        edited_at  TEXT
      );

      CREATE INDEX idx_bill_payments_bill_id ON bill_payments (bill_id);
    `);

    // The backfill. One full-amount entry per bill the owner had already
    // marked paid, carrying no date.
    await db.runAsync(
      `INSERT INTO bill_payments (bill_id, amount, paid_on, note, created_at)
       SELECT id, grand_total, NULL, ?, ?
         FROM bills
        WHERE paid = 1`,
      'Marked paid before payments were itemised',
      new Date().toISOString()
    );
  },
};

/**
 * Every migration ever shipped, in order. Append only.
 */
export const MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
];

/** The schema version the current build of the app expects. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0
);
