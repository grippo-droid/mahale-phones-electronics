'use strict';

/**
 * `expo-sqlite`, over Node's own SQLite.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE MAKING THE SHIM SIMPLER.
 *
 * Every bug that has reached the owner's phone got there through a place where
 * this shim was kinder than the real library. The sane implementation is
 * usually the wrong one here — the point is to reproduce what `expo-sqlite`
 * actually does, including the parts that look like mistakes.
 *
 * Two behaviours are load-bearing and must not be "cleaned up":
 *
 *   1. `withExclusiveTransactionAsync` opens a SECOND CONNECTION by
 *      `databasePath` and runs the callback on that. Running the callback on
 *      the same connection is the obvious implementation and it hid a shipped
 *      bug for a release: for a database opened by `deserializeDatabaseAsync`,
 *      `databasePath` is the literal ':memory:', so the second connection is a
 *      different, EMPTY database. Migrations ran against nothing while the
 *      suite stayed green, and restoring an older backup failed on the phone.
 *
 *   2. `deserializeDatabaseAsync` reports `databasePath` as ':memory:'. It is
 *      what makes (1) reproducible. The bytes are written to a temp file here
 *      because `node:sqlite` cannot deserialize, but the PATH it reports is the
 *      real library's, not the temp file's.
 *
 * Known gaps, so a passing suite is not read as saying more than it does:
 *
 *   - No native connection cache. The real `SQLiteModule.kt` reference-counts
 *     connections by path, which is what made a close-and-swap restore
 *     silently do nothing. Nothing here models that.
 *   - No WAL. Journal mode is accepted and ignored, so the WAL-header handling
 *     in `db/backup.ts` is exercised only through its pure byte manipulation.
 *   - No concurrency. `node:sqlite` is synchronous, so two "concurrent" writes
 *     serialise and a race cannot be driven at all.
 * ---------------------------------------------------------------------------
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MEMORY_PATH = ':memory:';

function scratchFile(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mpe-sqlite-${label}-`));
  return path.join(dir, 'db.sqlite');
}

class SQLiteDatabase {
  constructor(filePath, { reportedPath = filePath } = {}) {
    this._file = filePath;
    this._db = new DatabaseSync(filePath);
    /** What `expo-sqlite` would report. NOT always where the bytes are. */
    this.databasePath = reportedPath;
  }

  async execAsync(sql) {
    this._db.exec(sql);
  }

  async runAsync(sql, ...params) {
    const result = this._db.prepare(sql).run(...flatten(params));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getAllAsync(sql, ...params) {
    return this._db.prepare(sql).all(...flatten(params));
  }

  async getFirstAsync(sql, ...params) {
    const row = this._db.prepare(sql).get(...flatten(params));
    return row ?? null;
  }

  /**
   * A second connection by path — see note (1) at the top. Do not change this
   * to run the callback on `this`.
   */
  async withExclusiveTransactionAsync(callback) {
    const txn = new SQLiteDatabase(
      this.databasePath === MEMORY_PATH ? scratchFile('txn-memory') : this.databasePath
    );
    try {
      await txn.execAsync('BEGIN IMMEDIATE');
      await callback(txn);
      await txn.execAsync('COMMIT');
    } catch (error) {
      try {
        await txn.execAsync('ROLLBACK');
      } catch {
        // Already rolled back, or never begun.
      }
      throw error;
    } finally {
      await txn.closeAsync();
    }
  }

  async serializeAsync() {
    // The real one asks SQLite for a consistent snapshot. Reading the file is
    // equivalent here because nothing else holds the connection and there is
    // no WAL to miss commits in.
    return new Uint8Array(fs.readFileSync(this._file));
  }

  async closeAsync() {
    this._db.close();
  }
}

/** expo-sqlite accepts loose arrays as well as spread parameters. */
function flatten(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

async function openDatabaseAsync(name, _options, directory) {
  const dir = directory ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mpe-sqlite-'));
  fs.mkdirSync(dir, { recursive: true });
  return new SQLiteDatabase(path.join(dir, name));
}

/**
 * Opens bytes as a database of their own.
 *
 * `node:sqlite` has no deserialize, so the bytes go to a temp file — but the
 * reported path stays ':memory:', because that is what the real library
 * reports and what makes the transaction trap above reproducible.
 */
async function deserializeDatabaseAsync(bytes) {
  const file = scratchFile('deserialized');
  fs.writeFileSync(file, Buffer.from(bytes));
  return new SQLiteDatabase(file, { reportedPath: MEMORY_PATH });
}

/** SQLite's Online Backup API: copies one open connection over another. */
async function backupDatabaseAsync({ sourceDatabase, destDatabase }) {
  const bytes = await sourceDatabase.serializeAsync();
  fs.writeFileSync(destDatabase._file, Buffer.from(bytes));
  // The destination's handle is now looking at replaced bytes; reopen it so it
  // sees them, which is what the real copy leaves the caller with.
  destDatabase._db.close();
  destDatabase._db = new DatabaseSync(destDatabase._file);
}

// One at a time: Node's CommonJS named-export detection misses keys written
// inside an object literal, and the .ts sources import these by name.
exports.SQLiteDatabase = SQLiteDatabase;
exports.openDatabaseAsync = openDatabaseAsync;
exports.deserializeDatabaseAsync = deserializeDatabaseAsync;
exports.backupDatabaseAsync = backupDatabaseAsync;
exports.defaultDatabaseDirectory = os.tmpdir();
