import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  DATABASE_NAME,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  type SchemaVersionRow,
} from './schema';

/**
 * Database setup on app start.
 *
 * A module-level singleton rather than expo-sqlite's `SQLiteProvider`, on
 * purpose: Technical Architecture Section 9 requires the repository layer
 * (`db/products.ts`, `db/bills.ts`) to be callable from anywhere, including
 * outside React — seed scripts, backup/restore, and later a sync worker. Binding
 * the connection to a React context would make every one of those a component.
 */

let database: SQLiteDatabase | null = null;
let initPromise: Promise<SQLiteDatabase> | null = null;

/**
 * Opens the database and brings it up to LATEST_SCHEMA_VERSION.
 * Safe to call repeatedly — concurrent callers share one in-flight init, so the
 * migrations can never run twice.
 */
export function initDatabase(): Promise<SQLiteDatabase> {
  if (!initPromise) {
    initPromise = openAndMigrate().catch((error) => {
      // Let a later call retry rather than caching a failed connection forever.
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

/**
 * The open database. Throws if called before `initDatabase()` has resolved —
 * repository functions use this so they stay synchronous at the call site.
 */
export function getDatabase(): SQLiteDatabase {
  if (!database) {
    throw new Error('Database not initialised yet — await initDatabase() first.');
  }
  return database;
}

async function openAndMigrate(): Promise<SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

  // WAL keeps reads fast while a bill is being written; foreign keys enforce the
  // bill_items -> bills cascade. Both are per-connection and must be set here.
  await db.execAsync(`
    PRAGMA journal_mode = 'wal';
    PRAGMA foreign_keys = ON;
  `);

  await runMigrations(db);

  database = db;
  return db;
}

/**
 * Brings a database up to LATEST_SCHEMA_VERSION.
 *
 * Exported because a restore has to run it against the incoming database as
 * well as the live one — a backup taken on an older schema is brought forward
 * before its rows are copied in, so the two schemas match.
 */
export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY NOT NULL,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL
    );
  `);

  const currentVersion = await getSchemaVersion(db);

  if (currentVersion > LATEST_SCHEMA_VERSION) {
    // Happens if a newer build wrote this database and the app was then
    // downgraded, or a backup from a newer version was restored. Refusing is
    // safer than running old code against a schema it does not understand.
    throw new Error(
      `Database schema is version ${currentVersion} but this app only understands ` +
        `${LATEST_SCHEMA_VERSION}. Update the app to open this data.`
    );
  }

  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion).sort(
    (a, b) => a.version - b.version
  );

  for (const migration of pending) {
    // Each migration is atomic: either the DDL and its version row both land, or
    // neither does. A half-applied migration on the owner's phone is unfixable
    // remotely, so this matters more here than the transaction overhead costs.
    await db.withExclusiveTransactionAsync(async (txn) => {
      await migration.up(txn);
      await txn.runAsync(
        'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        new Date().toISOString()
      );
    });
  }
}

/** Highest applied migration version; 0 on a brand-new database. */
export async function getSchemaVersion(db: SQLiteDatabase = getDatabase()): Promise<number> {
  const row = await db.getFirstAsync<{ version: number | null }>(
    'SELECT MAX(version) AS version FROM schema_version'
  );
  return row?.version ?? 0;
}

/** Full migration history — useful when diagnosing a restored backup. */
export async function getAppliedMigrations(
  db: SQLiteDatabase = getDatabase()
): Promise<SchemaVersionRow[]> {
  return db.getAllAsync<SchemaVersionRow>(
    'SELECT version, name, applied_at FROM schema_version ORDER BY version ASC'
  );
}

/**
 * Closes and forgets the connection. Needed by restore (T6.3), which swaps the
 * database file underneath the app, and by tests.
 */
export async function closeDatabase(): Promise<void> {
  if (database) {
    await database.closeAsync();
    database = null;
  }
  initPromise = null;
}
