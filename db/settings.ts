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
} as const;

/** Used until the owner sets their own default in Settings. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

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
