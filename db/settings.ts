import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from './init';

/**
 * Key/value accessor over the `app_settings` table.
 *
 * Settings live in the database rather than AsyncStorage so that Phase 6
 * backup/restore carries them with the data — restoring onto a new phone would
 * otherwise silently lose the GSTIN and the invoice counter.
 *
 * T4.1 extends this with the full business details; for now it holds the global
 * low-stock default.
 */

export const SETTING_KEYS = {
  /** Fallback used when a product's own low_stock_threshold is NULL. */
  lowStockThreshold: 'low_stock_threshold_default',
  /** Invoice numbering (T3.2); editable in Settings from T4.1. */
  invoiceNumberFormat: 'invoice_number_format',
  invoiceResetPolicy: 'invoice_reset_policy',
  invoiceStartNumber: 'invoice_start_number',
} as const;

/** Used until the owner sets their own default in Settings. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/**
 * Storage key for one period's invoice counter.
 *
 * One row per period rather than a single counter plus a "current period" marker:
 * a closed financial year keeps its last used number on record, so reopening an
 * old period — a bill backdated across 1 April, a phone whose clock was wrong —
 * carries on from where that year stopped instead of reissuing from one.
 */
export function invoiceCounterKey(periodKey: string): string {
  return `invoice_seq:${periodKey}`;
}

export async function getSetting(
  key: string,
  db: SQLiteDatabase = getDatabase()
): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM app_settings WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string | null,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  await db.runAsync(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().toISOString()
  );
}

/**
 * Global low-stock threshold. Falls back to DEFAULT_LOW_STOCK_THRESHOLD if unset
 * or if the stored value is not a usable number.
 */
export async function getGlobalLowStockThreshold(
  db: SQLiteDatabase = getDatabase()
): Promise<number> {
  const raw = await getSetting(SETTING_KEYS.lowStockThreshold, db);
  if (raw === null) return DEFAULT_LOW_STOCK_THRESHOLD;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LOW_STOCK_THRESHOLD;
}

export async function setGlobalLowStockThreshold(
  threshold: number,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('Low stock threshold must be zero or more.');
  }
  await setSetting(SETTING_KEYS.lowStockThreshold, String(Math.floor(threshold)), db);
}

// ---------------------------------------------------------------------------
// Invoice numbering (T3.2)
// ---------------------------------------------------------------------------

/**
 * The last sequence number used in a period, or NULL if the period has not been
 * billed in yet. `lib/invoiceNumber.ts` owns the meaning; this only stores it.
 */
export async function getInvoiceCounter(
  periodKey: string,
  db: SQLiteDatabase = getDatabase()
): Promise<number | null> {
  const raw = await getSetting(invoiceCounterKey(periodKey), db);
  if (raw === null) return null;

  const parsed = Number.parseInt(raw, 10);
  // A corrupt counter must not silently restart the series at one, because that
  // would reissue numbers the customer already holds.
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invoice counter for ${periodKey} is corrupt (found "${raw}").`);
  }
  return parsed;
}

export async function setInvoiceCounter(
  periodKey: string,
  value: number,
  db: SQLiteDatabase = getDatabase()
): Promise<void> {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Invoice counter must be a whole number of zero or more.');
  }
  await setSetting(invoiceCounterKey(periodKey), String(value), db);
}

/** Every period that has been billed in, for Settings and diagnostics. */
export async function listInvoiceCounters(
  db: SQLiteDatabase = getDatabase()
): Promise<{ periodKey: string; lastUsed: number }[]> {
  const rows = await db.getAllAsync<{ key: string; value: string | null }>(
    "SELECT key, value FROM app_settings WHERE key LIKE 'invoice\\_seq:%' ESCAPE '\\' ORDER BY key"
  );
  return rows.map((row) => ({
    periodKey: row.key.slice('invoice_seq:'.length),
    lastUsed: Number.parseInt(row.value ?? '0', 10),
  }));
}

// Reading and writing the invoice *format* settings lives in
// `lib/invoiceNumber.ts`, on top of getSetting/setSetting above. It needs that
// module's defaults and validation, and this file must not import it back —
// `lib/invoiceNumber.ts` already imports from here, and a cycle between the two
// leaves one of them half-initialised at startup.
