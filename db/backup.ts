import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import * as SQLite from 'expo-sqlite';

import { getDatabase, getSchemaVersion, runMigrations } from './init';
import { LATEST_SCHEMA_VERSION } from './schema';
import { BUSINESS_SETTING_KEYS, setLastBackupAt } from './settings';

/**
 * Backup export (T6.1).
 *
 * The shop's entire record — every product, every bill, the invoice counters and
 * the business details — lives in one SQLite file on one phone. A lost phone
 * takes all of it, and the invoice counter going with it is the worst part: a
 * fresh install starts numbering at 1 and reissues numbers customers already
 * hold. This module is the way out of that.
 *
 * ---------------------------------------------------------------------------
 * The file format
 *
 * Technical Architecture 5.3 asks for "the SQLite database file (plus a
 * manifest) into a single exportable file". That is two things in one file, and
 * the container is deliberately trivial:
 *
 *     MAHALE-BACKUP/1\n          <- magic line, so a wrong file is refused
 *     {"format":1,...}\n         <- the manifest, one line of JSON
 *     <raw SQLite bytes>         <- byte-for-byte, no encoding
 *
 * No zip, and no base64. A zip means a new dependency for a container holding
 * two members. Base64 inside JSON would inflate the shop's data by a third and
 * make the file unopenable by anything but this app.
 *
 * What this format buys instead: the first two lines are plain text, so the
 * manifest can be read by opening the file in any text editor — which is worth
 * a great deal when the owner is in another city and something has gone wrong.
 * The rest is a real SQLite database that a desktop tool can open directly if
 * this app ever cannot.
 * ---------------------------------------------------------------------------
 *
 * Both halves of the format live here — writing and reading. A format that is
 * only ever written is not known to be readable, and finding that out during
 * T6.3's restore, with the owner's data as the test case, is too late.
 */

const MAGIC = 'MAHALE-BACKUP';

/** Bumped only for a change that older builds cannot read. */
const FORMAT_VERSION = 1;

/** Every SQLite file begins with this. Cheap proof the payload is what it says. */
const SQLITE_HEADER = 'SQLite format 3\u0000';

const BACKUP_DIRECTORY_NAME = 'backups';

export const BACKUP_FILE_EXTENSION = '.mpebak';

/**
 * How many exports to keep on the phone.
 *
 * The real backup is the copy the owner sends to Drive; these are local
 * convenience copies, so a failed share can be retried without regenerating.
 * Keeping every one of them would grow without limit on a phone that has no
 * spare storage to give.
 */
const KEEP_LOCAL_BACKUPS = 3;

export type BackupCounts = {
  products: number;
  bills: number;
  billItems: number;
  settings: number;
};

export type BackupManifest = {
  format: number;
  app: string;
  appVersion: string;
  /** The schema the database was on, so a restore can refuse what it cannot read. */
  schemaVersion: number;
  createdAt: string;
  /** Which shop's data this is. Null while the business name is still a placeholder. */
  shopName: string | null;
  databaseBytes: number;
  /** Detects truncation and corruption. Not a signature — see `checksum`. */
  checksum: string;
  counts: BackupCounts;
};

export type ParsedBackup = {
  manifest: BackupManifest;
  database: Uint8Array;
};

/**
 * A backup that failed to parse or validate, carrying wording fit to show the
 * owner rather than a stack trace.
 */
export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/**
 * FNV-1a, 32-bit, as eight hex characters.
 *
 * This detects a damaged or truncated file — a share interrupted half way, a
 * cloud sync that mangled the bytes. It is **not** a signature and proves
 * nothing about who made the file: anyone editing a backup can recompute it.
 * That is an accepted limit, because the threat here is accident, not an
 * attacker; Security & Access 5 already says a backup is as sensitive as the
 * phone and is not encrypted.
 *
 * Chosen over a cryptographic hash because it needs no dependency and no native
 * module, and runs over a few megabytes in milliseconds.
 */
export function checksum(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    // The FNV prime, 16777619, multiplied without overflowing a double.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Encoding and decoding — pure, so the format is testable without a phone
// ---------------------------------------------------------------------------

/**
 * UTF-8 encode without depending on TextEncoder.
 *
 * Hermes has TextEncoder, but the manifest can contain a shop name with any
 * character in it and this is a legal record; doing the encoding here means the
 * bytes are the same everywhere and the byte length in the manifest can be
 * trusted. Surrogate pairs are handled; a lone surrogate becomes U+FFFD rather
 * than producing invalid UTF-8.
 */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];

  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        code = 0xfffd; // unpaired high surrogate
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd; // unpaired low surrogate
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }

  return Uint8Array.from(out);
}

/** The inverse of `utf8Encode`, for reading the header lines back. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';

  for (let i = 0; i < bytes.length; ) {
    const byte = bytes[i];
    let code: number;
    let width: number;

    if (byte < 0x80) {
      code = byte;
      width = 1;
    } else if ((byte & 0xe0) === 0xc0) {
      code = byte & 0x1f;
      width = 2;
    } else if ((byte & 0xf0) === 0xe0) {
      code = byte & 0x0f;
      width = 3;
    } else if ((byte & 0xf8) === 0xf0) {
      code = byte & 0x07;
      width = 4;
    } else {
      out += '\ufffd';
      i++;
      continue;
    }

    if (i + width > bytes.length) {
      out += '\ufffd';
      break;
    }

    for (let k = 1; k < width; k++) code = (code << 6) | (bytes[i + k] & 0x3f);
    i += width;

    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }

  return out;
}

/** Builds the complete backup file: magic line, manifest line, database bytes. */
export function encodeBackup(database: Uint8Array, manifest: BackupManifest): Uint8Array {
  const header = utf8Encode(`${MAGIC}/${manifest.format}\n${JSON.stringify(manifest)}\n`);

  const out = new Uint8Array(header.length + database.length);
  out.set(header, 0);
  out.set(database, header.length);
  return out;
}

/**
 * Reads a backup file and checks it is one, in the order that gives the most
 * useful message: is it ours, can we read this version, is the manifest intact,
 * are the bytes all there, and are they undamaged.
 *
 * Everything it can reject here is something T6.3 must never hand to the
 * database. Overwriting the shop's live data with a half-copied file is the one
 * unrecoverable thing this app can do.
 */
export function decodeBackup(bytes: Uint8Array): ParsedBackup {
  const NEWLINE = 0x0a;

  const firstBreak = bytes.indexOf(NEWLINE);
  if (firstBreak < 0) {
    throw new BackupFormatError('This file is not a Mahale backup.');
  }

  const magicLine = utf8Decode(bytes.subarray(0, firstBreak));
  const [magic, versionText] = magicLine.split('/');
  if (magic !== MAGIC) {
    throw new BackupFormatError('This file is not a Mahale backup.');
  }

  const version = Number(versionText);
  if (!Number.isInteger(version) || version < 1) {
    throw new BackupFormatError('This backup file is damaged — its version is unreadable.');
  }
  if (version > FORMAT_VERSION) {
    throw new BackupFormatError(
      `This backup was made by a newer version of the app (backup format ${version}). ` +
        'Update the app, then try again.'
    );
  }

  const secondBreak = bytes.indexOf(NEWLINE, firstBreak + 1);
  if (secondBreak < 0) {
    throw new BackupFormatError('This backup file is incomplete — it has no details block.');
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(utf8Decode(bytes.subarray(firstBreak + 1, secondBreak)));
  } catch {
    throw new BackupFormatError('This backup file is damaged — its details cannot be read.');
  }

  const database = bytes.subarray(secondBreak + 1);

  if (database.length !== manifest.databaseBytes) {
    throw new BackupFormatError(
      'This backup file is incomplete. It may not have finished copying — ' +
        `it holds ${database.length} bytes of ${manifest.databaseBytes}.`
    );
  }

  if (checksum(database) !== manifest.checksum) {
    throw new BackupFormatError('This backup file is damaged and cannot be restored.');
  }

  if (utf8Decode(database.subarray(0, SQLITE_HEADER.length)) !== SQLITE_HEADER) {
    throw new BackupFormatError('This backup file does not contain a database.');
  }

  // Matches the rule db/init.ts already applies to the live database: old code
  // must not run against a schema written by a newer build.
  if (manifest.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw new BackupFormatError(
      `This backup was made by a newer version of the app (data version ${manifest.schemaVersion}, ` +
        `this app understands ${LATEST_SCHEMA_VERSION}). Update the app, then try again.`
    );
  }

  return { manifest, database };
}

// ---------------------------------------------------------------------------
// Creating a backup
// ---------------------------------------------------------------------------

export type BackupResult = {
  /** Absolute URI, ready to hand to `expo-sharing` in T6.2. */
  uri: string;
  fileName: string;
  sizeBytes: number;
  manifest: BackupManifest;
};

function backupDirectory(): Directory {
  return new Directory(Paths.document, BACKUP_DIRECTORY_NAME);
}

/**
 * `mahale-backup-2026-08-20-1530.mpebak`.
 *
 * Local time and sortable, because the owner picks a file out of a Drive
 * listing by eye and the useful question is always "which is the newest".
 */
export function backupFileName(when: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `mahale-backup-${stamp}${BACKUP_FILE_EXTENSION}`;
}

async function countRows(db: SQLiteDatabase, table: string): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return row?.count ?? 0;
}

/**
 * The shop's own name, or null while it is still the compiled placeholder.
 *
 * Read straight from `app_settings` rather than from the settings store: this
 * has to work from outside React, and the manifest should describe the database
 * being copied rather than whatever a screen currently holds.
 */
async function shopNameFor(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM app_settings WHERE key = ?',
    BUSINESS_SETTING_KEYS.name
  );
  const name = row?.value?.trim();
  if (!name || name.startsWith('PLACEHOLDER')) return null;
  return name;
}

/**
 * Serialises the live database and writes it, with its manifest, to a single
 * file in the document directory. Returns where it landed so T6.2 can share it.
 *
 * `serializeAsync` is SQLite's own serialize call, which produces a consistent
 * snapshot rather than a copy of a file that may be mid-write. The checkpoint
 * before it is belt and braces: the connection runs in WAL mode, so recent
 * commits can still be sitting in the write-ahead log, and folding them back
 * into the database first removes any question of what the snapshot contains.
 */
export async function createBackup(
  db: SQLiteDatabase = getDatabase(),
  when: Date = new Date()
): Promise<BackupResult> {
  await db.execAsync("PRAGMA wal_checkpoint(TRUNCATE);");

  const database = await db.serializeAsync();

  const [schemaVersion, products, bills, billItems, settings, shopName] = await Promise.all([
    getSchemaVersion(db),
    countRows(db, 'products'),
    countRows(db, 'bills'),
    countRows(db, 'bill_items'),
    countRows(db, 'app_settings'),
    shopNameFor(db),
  ]);

  const manifest: BackupManifest = {
    format: FORMAT_VERSION,
    app: 'mahale-phones-electronics',
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    schemaVersion,
    createdAt: when.toISOString(),
    shopName,
    databaseBytes: database.length,
    checksum: checksum(database),
    counts: { products, bills, billItems, settings },
  };

  const directory = backupDirectory();
  if (!directory.exists) directory.create({ intermediates: true });

  const fileName = backupFileName(when);
  const file = new File(directory, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(encodeBackup(database, manifest));

  pruneOldBackups(file.uri);

  // Recorded here rather than by the caller, because this is the one place
  // that knows a backup file now exists. It claims nothing about the file
  // having left the phone — see setLastBackupAt.
  await setLastBackupAt(when, db);

  return { uri: file.uri, fileName, sizeBytes: file.size, manifest };
}

// ---------------------------------------------------------------------------
// Reading backups back
// ---------------------------------------------------------------------------

/** Local backup files, newest first. The filename sorts chronologically. */
export function listBackups(): File[] {
  const directory = backupDirectory();
  if (!directory.exists) return [];

  return directory
    .list()
    .filter((entry): entry is File => entry instanceof File)
    .filter((file) => file.uri.endsWith(BACKUP_FILE_EXTENSION))
    .sort((a, b) => (a.uri < b.uri ? 1 : a.uri > b.uri ? -1 : 0));
}

/**
 * Keeps the newest few and removes the rest.
 *
 * `protect` is the file just written, and it is excluded unconditionally rather
 * than trusted to sort first. "Newest" here means newest *by filename*, and the
 * filename carries the phone's clock — so a device whose date is wrong, or has
 * been set back, produces a name that sorts last. Without this the export would
 * report success and then immediately delete itself, which is the worst
 * possible way for a backup feature to fail.
 *
 * Failures are swallowed: housekeeping going wrong is not a reason to tell the
 * owner the backup failed, when the backup itself is already on disk.
 */
function pruneOldBackups(protect: string, keep: number = KEEP_LOCAL_BACKUPS): void {
  try {
    const others = listBackups().filter((file) => file.uri !== protect);
    for (const file of others.slice(Math.max(keep - 1, 0))) {
      try {
        file.delete();
      } catch {
        // Leaving an old backup in place is harmless.
      }
    }
  } catch {
    // Same.
  }
}

/**
 * Reads and validates a backup file without touching the live database.
 *
 * This is what T6.3 calls to fill in its confirmation prompt: it is the
 * difference between asking "replace all your data?" and asking "replace your
 * data with this backup from 12 August holding 214 bills?" — which is the only
 * form of that question the owner can actually answer.
 */
export async function inspectBackup(uri: string): Promise<ParsedBackup> {
  const file = new File(uri);
  if (!file.exists) throw new BackupFormatError('That backup file could not be found.');

  return decodeBackup(await file.bytes());
}

// ---------------------------------------------------------------------------
// Restore (T6.3)
// ---------------------------------------------------------------------------

/**
 * Why a restore copies rows instead of replacing the database file.
 *
 * The obvious implementation — close the connection, overwrite `mahale.db`,
 * reopen — silently does nothing on this platform, and was shipped and caught
 * on the phone doing exactly that: the restore reported success and the data
 * was unchanged.
 *
 * `SQLiteModule.kt` reference-counts connections. Its constructor looks for an
 * already-open database on the same path and, if it finds one, calls `addRef()`
 * and hands back the existing handle — a cache it keeps expressly "for fast
 * refresh". `closeAsync` mirrors that: it calls `release()` and only truly
 * closes when the count reaches zero. So a `closeAsync` need not close
 * anything. The old `sqlite3*` stays open on the old inode; deleting the file
 * only unlinks the name, and reopening returns that same cached handle, still
 * reading the file that was deleted. Nothing throws. Nothing changes.
 *
 * So the file is never replaced. The incoming database is written to a staging
 * file, brought up to the current schema in its own right, then ATTACHed to the
 * live connection and copied in one transaction. That is immune to all of it —
 * no closing, no refcounts, no inodes, no `-wal` to clear — and it gets a
 * better guarantee for free: SQLite's transaction *is* the rollback. If the
 * copy fails at any point, the shop's data is exactly as it was, without any
 * snapshot having to be written back by hand.
 */

/** Tables copied by a restore, parents before children so foreign keys hold. */
const RESTORED_TABLES = ['products', 'bills', 'bill_items', 'app_settings'] as const;

/** Where the incoming database is staged. The document directory is writable. */
const STAGING_DIRECTORY_NAME = 'restore-staging';

const STAGING_DATABASE_NAME = 'incoming.db';

/** What a restore would replace, and what with. */
export type RestorePreview = {
  /** The backup's own description of itself. */
  manifest: BackupManifest;
  /** What is on the phone right now, so the two can be compared before deciding. */
  current: BackupCounts & { shopName: string | null };
};

/**
 * Reads a backup and pairs it with what is currently on the phone.
 *
 * This exists so the confirmation is answerable. "Replace all your data?" is a
 * question nobody can say yes to safely; "replace 214 bills with the 198 in this
 * backup from 12 August?" is one the owner can actually judge.
 */
export async function previewRestore(
  uri: string,
  db: SQLiteDatabase = getDatabase()
): Promise<RestorePreview> {
  const { manifest } = await inspectBackup(uri);
  const current = await countAllRows(db);
  return { manifest, current: { ...current, shopName: await shopNameFor(db) } };
}

async function countAllRows(db: SQLiteDatabase): Promise<BackupCounts> {
  const [products, bills, billItems, settings] = await Promise.all([
    countRows(db, 'products'),
    countRows(db, 'bills'),
    countRows(db, 'bill_items'),
    countRows(db, 'app_settings'),
  ]);
  return { products, bills, billItems, settings };
}

/**
 * How a failed restore left the phone.
 *
 * There is no `unrecovered` any more, and that is the point of the rewrite: the
 * copy runs inside a single transaction, so a failure leaves the shop's data
 * exactly as it was rather than needing a snapshot written back by hand.
 */
export type RestoreOutcome =
  /** The copy was rolled back by SQLite. Nothing on the phone changed. */
  | 'untouched'
  /** The copy committed, but the result does not match the backup. */
  | 'mismatch';

const RESTORE_OUTCOME_MESSAGES: Record<RestoreOutcome, string> = {
  untouched:
    'The backup could not be restored, so nothing on this phone was changed. ' +
    'Your products and bills are exactly as they were.',
  mismatch:
    'The backup was restored but the result does not match what the file said it held. ' +
    'Check your products and bills before carrying on, and do not delete the backup file.',
};

export class RestoreFailedError extends Error {
  readonly outcome: RestoreOutcome;

  /** Whether the shop's own data is intact. */
  readonly rolledBack: boolean;

  constructor(outcome: RestoreOutcome, options?: { cause?: unknown }) {
    super(RESTORE_OUTCOME_MESSAGES[outcome], options);
    this.name = 'RestoreFailedError';
    this.outcome = outcome;
    this.rolledBack = outcome === 'untouched';
  }
}

/**
 * The steps a restore is made of, injected so the failure paths can be tested.
 *
 * Every one of these touches the filesystem or the live connection, neither of
 * which exists in a test — but what happens when one fails is the whole safety
 * of the operation, and untested recovery code is code that has never run.
 */
export type RestoreIo = {
  /** Keeps a copy of the current data, in case something unforeseen happens. */
  keepSafetyCopy: () => Promise<void>;
  /** Writes the incoming database where it can be opened, and returns its path. */
  stageDatabase: (bytes: Uint8Array) => Promise<string>;
  /** Brings the staged database up to the current schema, if it is older. */
  migrateStaged: (path: string) => Promise<void>;
  /** Copies every table across in one transaction. Throws having changed nothing. */
  importFrom: (path: string) => Promise<void>;
  /** What the live database holds now. */
  countRows: () => Promise<BackupCounts>;
  discardStaged: (path: string) => void;
};

/**
 * Replaces the shop's data with a backup's.
 *
 * The counts are checked against the manifest afterwards, and that check is not
 * ceremony: the previous implementation reported success while changing
 * nothing, and passed its own verification because all that proved was that the
 * database could still be read. A restore that did not restore has to fail
 * loudly, or the owner finds out when they need the data.
 */
export async function performRestore(
  database: Uint8Array,
  manifest: BackupManifest,
  io: RestoreIo
): Promise<void> {
  let staged: string | null = null;

  try {
    await io.keepSafetyCopy();

    staged = await io.stageDatabase(database);
    await io.migrateStaged(staged);

    try {
      await io.importFrom(staged);
    } catch (error) {
      // SQLite rolled the transaction back, so the shop is where it started.
      throw new RestoreFailedError('untouched', { cause: error });
    }

    const after = await io.countRows();
    if (
      after.products !== manifest.counts.products ||
      after.bills !== manifest.counts.bills ||
      after.billItems !== manifest.counts.billItems
    ) {
      throw new RestoreFailedError('mismatch');
    }
  } catch (error) {
    if (error instanceof RestoreFailedError) throw error;
    throw new RestoreFailedError('untouched', { cause: error });
  } finally {
    if (staged !== null) io.discardStaged(staged);
  }
}

/** Where the pre-restore safety copy goes. Outside `backups/`, so pruning never takes it. */
const SAFETY_DIRECTORY_NAME = 'restore-safety';

export const SAFETY_COPY_NAME = `before-restore${BACKUP_FILE_EXTENSION}`;

/**
 * Column names shared by the same table in both databases, quoted for SQL.
 *
 * `INSERT INTO x SELECT * FROM restore.x` would be shorter, and would break the
 * day the two schemas differ in column *order* rather than content — which
 * `ALTER TABLE ADD COLUMN` makes possible without anyone noticing. Naming the
 * columns means a restore either copies the right values or fails outright.
 */
async function sharedColumns(
  db: SQLiteDatabase,
  table: string,
  attachedAs: string
): Promise<string[]> {
  const [live, staged] = await Promise.all([
    db.getAllAsync<{ name: string }>(`PRAGMA table_info('${table}')`),
    db.getAllAsync<{ name: string }>(`PRAGMA ${attachedAs}.table_info('${table}')`),
  ]);

  const stagedNames = new Set(staged.map((column) => column.name));
  return live
    .map((column) => column.name)
    .filter((name) => stagedNames.has(name))
    .map((name) => `"${name}"`);
}

/** Builds the real steps, bound to the connection that is open right now. */
export function fileSystemRestoreIo(db: SQLiteDatabase = getDatabase()): RestoreIo {
  const stagingDirectory = () => new Directory(Paths.document, STAGING_DIRECTORY_NAME);

  return {
    keepSafetyCopy: async () => {
      // An ordinary backup, in the ordinary format, so that if it is ever
      // needed it can be restored through this same flow rather than by hand.
      const directory = new Directory(Paths.document, SAFETY_DIRECTORY_NAME);
      if (!directory.exists) directory.create({ intermediates: true });

      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
      const bytes = await db.serializeAsync();
      const counts = await countAllRows(db);

      const manifest: BackupManifest = {
        format: FORMAT_VERSION,
        app: 'mahale-phones-electronics',
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        schemaVersion: await getSchemaVersion(db),
        createdAt: new Date().toISOString(),
        shopName: await shopNameFor(db),
        databaseBytes: bytes.length,
        checksum: checksum(bytes),
        counts,
      };

      const file = new File(directory, SAFETY_COPY_NAME);
      if (file.exists) file.delete();
      file.create();
      file.write(encodeBackup(bytes, manifest));
    },

    stageDatabase: async (bytes) => {
      const directory = stagingDirectory();
      if (!directory.exists) directory.create({ intermediates: true });

      const file = new File(directory, STAGING_DATABASE_NAME);
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);

      // Any sidecar left by a previous attempt would be replayed over the file
      // that has just been written — the same trap as the live database's.
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = new File(directory, `${STAGING_DATABASE_NAME}${suffix}`);
        if (sidecar.exists) sidecar.delete();
      }

      return file.uri;
    },

    // Opened as a database in its own right so `runMigrations` can bring it
    // forward, then closed. Opening by name and directory keeps expo-sqlite in
    // charge of the path, and `useNewConnection` keeps it out of the connection
    // cache that made replacing the file useless.
    migrateStaged: async (path) => {
      const { directory, name } = splitPath(fileSystemPath(path));
      const staged = await SQLite.openDatabaseAsync(
        name,
        { useNewConnection: true },
        directory
      );
      try {
        await staged.execAsync('PRAGMA foreign_keys = OFF;');
        await runMigrations(staged);
      } finally {
        await staged.closeAsync();
      }
    },

    importFrom: async (path) => {
      // ATTACH cannot run inside a transaction, so it brackets the copy.
      await db.execAsync(`ATTACH DATABASE '${sqlLiteral(fileSystemPath(path))}' AS restore;`);

      try {
        await db.withExclusiveTransactionAsync(async (txn) => {
          // Held over until the commit, so the tables can be emptied and filled
          // in whatever order without a foreign key firing mid-way.
          await txn.execAsync('PRAGMA defer_foreign_keys = ON;');

          for (const table of [...RESTORED_TABLES].reverse()) {
            await txn.execAsync(`DELETE FROM "${table}";`);
          }

          for (const table of RESTORED_TABLES) {
            const columns = await sharedColumns(txn, table, 'restore');
            if (columns.length === 0) {
              throw new Error(`The backup has no usable "${table}" table.`);
            }
            const list = columns.join(', ');
            await txn.execAsync(
              `INSERT INTO "${table}" (${list}) SELECT ${list} FROM restore."${table}";`
            );
          }
        });
      } finally {
        await db.execAsync('DETACH DATABASE restore;');
      }
    },

    countRows: () => countAllRows(db),

    discardStaged: () => {
      try {
        const directory = stagingDirectory();
        if (directory.exists) directory.delete();
      } catch {
        // A staging file left behind is overwritten by the next restore.
      }
    },
  };
}

/**
 * Splits a path into the directory and file name expo-sqlite wants.
 *
 * Both separators are accepted. Android only ever produces forward slashes, but
 * the test harness runs on Windows, and a path helper that cannot be exercised
 * off the phone is one more thing only the owner's device can find wrong.
 */
function splitPath(fullPath: string): { directory: string; name: string } {
  const BACKSLASH = String.fromCharCode(92);
  const at = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf(BACKSLASH));
  return { directory: fullPath.slice(0, at), name: fullPath.slice(at + 1) };
}

/** Strips the `file://` scheme; SQLite and expo-sqlite both take plain paths. */
function fileSystemPath(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

/** Escapes a value for a single-quoted SQL literal. ATTACH cannot be parameterised. */
function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * The whole flow: read the file, check it, then copy it in.
 *
 * Validation runs again here even though the screen has already previewed the
 * file. The preview and the restore are separated by however long the owner
 * spends reading the confirmation.
 */
export async function restoreBackup(
  uri: string,
  io: RestoreIo = fileSystemRestoreIo()
): Promise<BackupManifest> {
  const { manifest, database } = await inspectBackup(uri);
  await performRestore(database, manifest, io);
  return manifest;
}
