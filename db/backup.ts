import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { closeDatabase, getDatabase, getSchemaVersion, initDatabase } from './init';
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

  const [products, bills, billItems, settings, shopName] = await Promise.all([
    countRows(db, 'products'),
    countRows(db, 'bills'),
    countRows(db, 'bill_items'),
    countRows(db, 'app_settings'),
    shopNameFor(db),
  ]);

  return { manifest, current: { products, bills, billItems, settings, shopName } };
}

/**
 * The steps a restore is made of, injected so the recovery path can be tested.
 *
 * Everything here either touches the filesystem or the live connection, neither
 * of which exists in a test — but the ordering, and what happens when a step
 * fails, is the entire safety of the operation. Untested rollback code is code
 * that has never run.
 */
export type RestoreIo = {
  /** A snapshot of the current database, taken before anything is destroyed. */
  snapshotCurrent: () => Promise<Uint8Array>;
  /** Keeps the snapshot somewhere the owner could still reach it by hand. */
  keepSafetyCopy: (bytes: Uint8Array) => Promise<void>;
  closeDatabase: () => Promise<void>;
  /**
   * Removes the write-ahead log beside the database file.
   *
   * Not optional. SQLite runs in WAL mode here, and a `-wal` left over from the
   * old database will be replayed on top of the new one — which is not a failed
   * restore but a corrupted database, the one outcome worse than doing nothing.
   */
  clearWriteAheadLog: () => void;
  writeDatabase: (bytes: Uint8Array) => void;
  /** Reopens and migrates. An older backup is brought forward here. */
  openDatabase: () => Promise<void>;
  /** Reads something back, to prove the restored file is actually usable. */
  verify: () => Promise<void>;
};

/**
 * How a failed restore left the phone.
 *
 * The distinction is not academic. The commonest failure is the write being
 * refused before anything has been overwritten, and telling the owner his data
 * could not be put back — when the file was never touched — is a false alarm
 * about the one thing he cannot afford to be wrong about.
 */
export type RestoreOutcome =
  /** The write never happened, so the original database is exactly as it was. */
  | 'untouched'
  /** The original was written back over the failed restore, and reopened. */
  | 'rolled-back'
  /** The data is in place, but the connection could not be reopened. */
  | 'needs-restart'
  /** The original could not be put back. The safety copy is the way out. */
  | 'unrecovered';

const RESTORE_OUTCOME_MESSAGES: Record<RestoreOutcome, string> = {
  untouched:
    'The restore could not be started, so nothing on this phone was changed. ' +
    'Your products and bills are exactly as they were.',
  'rolled-back':
    'The backup could not be restored, so your existing data has been put back. Nothing was lost.',
  'needs-restart':
    'Your data is still on this phone, but the app could not reopen it. ' +
    'Please close the app completely and open it again.',
  unrecovered:
    'The backup could not be restored, and your existing data could not be put back. ' +
    'Do not close the app — a copy was saved on this phone before the restore started.',
};

export class RestoreFailedError extends Error {
  readonly outcome: RestoreOutcome;

  /** Whether the shop's own data is intact. False only for `unrecovered`. */
  readonly rolledBack: boolean;

  constructor(outcome: RestoreOutcome, options?: { cause?: unknown }) {
    super(RESTORE_OUTCOME_MESSAGES[outcome], options);
    this.name = 'RestoreFailedError';
    this.outcome = outcome;
    this.rolledBack = outcome !== 'unrecovered';
  }
}

/**
 * Replaces the database with a backup, putting the old one back if anything
 * goes wrong.
 *
 * The order is the safety: snapshot first, and only then close, clear and
 * overwrite. If the new database will not open, or opens but cannot be read,
 * the snapshot goes back and the shop is where it started.
 *
 * Two rules the recovery path has to follow, both learned the hard way:
 *
 *   - **The connection is always reopened, whatever else failed.** Leaving it
 *     closed does not fail the restore, it breaks the entire app — every screen
 *     that touches the database throws until it is force-quit, and the message
 *     the owner sees is whatever internal text happens to surface first.
 *
 *   - **What actually happened is reported, not the worst case.** If the write
 *     was refused, nothing was overwritten and the honest answer is that nothing
 *     changed. Raising the alarm about data loss that did not occur spends
 *     credibility that is needed for the case where it did.
 */
export async function performRestore(database: Uint8Array, io: RestoreIo): Promise<void> {
  const snapshot = await io.snapshotCurrent();

  // Written to disk as well as held in memory: if the app is killed mid-restore
  // — the phone runs out of memory, the owner switches away — this file is the
  // only remaining copy of what was there before.
  await io.keepSafetyCopy(snapshot);

  await io.closeDatabase();

  // Tracks whether the database file was actually overwritten, which is what
  // separates "nothing happened" from "something has to be put back".
  let replaced = false;

  try {
    io.clearWriteAheadLog();
    io.writeDatabase(database);
    replaced = true;

    await io.openDatabase();
    await io.verify();
    return;
  } catch (error) {
    throw new RestoreFailedError(await recover(io, snapshot, replaced), { cause: error });
  }
}

/**
 * Puts things back as far as they will go, and reports how far that was.
 *
 * The reopen is attempted unconditionally and in its own try, so that a failure
 * to write the snapshot back cannot also cost the app its connection.
 */
async function recover(
  io: RestoreIo,
  snapshot: Uint8Array,
  replaced: boolean
): Promise<RestoreOutcome> {
  // Nothing was overwritten, so there is nothing to put back.
  let intact = !replaced;

  if (replaced) {
    try {
      io.clearWriteAheadLog();
      io.writeDatabase(snapshot);
      intact = true;
    } catch {
      intact = false;
    }
  }

  let reopened = false;
  try {
    await io.openDatabase();
    reopened = true;
  } catch {
    reopened = false;
  }

  if (!intact) return 'unrecovered';
  if (!reopened) return 'needs-restart';
  return replaced ? 'rolled-back' : 'untouched';
}

/** Where the pre-restore snapshot goes. Outside `backups/`, so pruning never takes it. */
const SAFETY_DIRECTORY_NAME = 'restore-safety';

export const SAFETY_COPY_NAME = `before-restore${BACKUP_FILE_EXTENSION}`;

/**
 * A `file://` URI for a path that may be either. `SQLiteDatabase.databasePath`
 * is a plain filesystem path; `expo-file-system` wants a URI.
 */
function asFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/**
 * Builds the real steps, bound to the database that is open right now.
 *
 * The path is read from the live connection rather than rebuilt from
 * `defaultDatabaseDirectory` and the database name, so it cannot drift from
 * wherever expo-sqlite actually put the file.
 */
export function fileSystemRestoreIo(db: SQLiteDatabase = getDatabase()): RestoreIo {
  const databaseUri = asFileUri(db.databasePath);
  const databaseFile = () => new File(databaseUri);

  return {
    snapshotCurrent: async () => {
      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
      return db.serializeAsync();
    },

    keepSafetyCopy: async (bytes) => {
      const directory = new Directory(Paths.document, SAFETY_DIRECTORY_NAME);
      if (!directory.exists) directory.create({ intermediates: true });

      const manifest: BackupManifest = {
        format: FORMAT_VERSION,
        app: 'mahale-phones-electronics',
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        schemaVersion: LATEST_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        shopName: null,
        databaseBytes: bytes.length,
        checksum: checksum(bytes),
        counts: { products: 0, bills: 0, billItems: 0, settings: 0 },
      };

      // Kept in the same format as any other backup, so if it is ever needed it
      // can be restored by the same flow rather than by a developer.
      const file = new File(directory, SAFETY_COPY_NAME);
      if (file.exists) file.delete();
      file.create();
      file.write(encodeBackup(bytes, manifest));
    },

    closeDatabase: () => closeDatabase(),

    clearWriteAheadLog: () => {
      for (const suffix of ['-wal', '-shm']) {
        try {
          const sidecar = new File(`${databaseUri}${suffix}`);
          if (sidecar.exists) sidecar.delete();
        } catch {
          // Absent is the desired state; failing to delete what is not there is
          // not a problem worth aborting a restore for.
        }
      }
    },

    writeDatabase: (bytes) => {
      const file = databaseFile();
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);
    },

    openDatabase: async () => {
      await initDatabase();
    },

    // Reads across all four tables. Opening proves the header is intact; this
    // proves the schema is there and the rows can actually be queried, which is
    // what "restored" has to mean.
    verify: async () => {
      const db2 = getDatabase();
      await Promise.all([
        countRows(db2, 'products'),
        countRows(db2, 'bills'),
        countRows(db2, 'bill_items'),
        countRows(db2, 'app_settings'),
      ]);
    },
  };
}

/**
 * The whole flow: read the file, check it, then replace the database.
 *
 * Validation runs again here even though the screen has already previewed the
 * file. The preview and the restore are separated by however long the owner
 * spends reading the confirmation, and this is the step that cannot be undone.
 */
export async function restoreBackup(
  uri: string,
  io: RestoreIo = fileSystemRestoreIo()
): Promise<BackupManifest> {
  const { manifest, database } = await inspectBackup(uri);
  await performRestore(database, io);
  return manifest;
}
