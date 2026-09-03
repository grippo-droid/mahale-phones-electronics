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
 * Why a restore touches no files at all.
 *
 * Two implementations of this failed on the owner's phone, and both failed for
 * the same underlying reason: they went through the filesystem, and the
 * filesystem is where this platform's surprises live.
 *
 *   1. **Close the connection and swap `mahale.db`.** It reported success and
 *      changed nothing. `SQLiteModule.kt` reference-counts connections: the
 *      constructor hands back an already-open handle for the same path (a cache
 *      kept expressly "for fast refresh"), and `closeAsync` only releases a
 *      reference, closing for real at zero. So the old `sqlite3*` stayed open on
 *      the old inode, deleting the file only unlinked the name, and reopening
 *      returned the same cached handle still reading the deleted file.
 *
 *   2. **Stage the file and `ATTACH` it.** That needs a plain filesystem path,
 *      and under Expo Go the document directory is scoped by experience id —
 *      `.../ExperienceData/%40anonymous%2F<slug>/`. Whether the escaping is part
 *      of the URI or part of the directory's actual name on disk decides whether
 *      that string should be decoded, and it cannot be determined from here.
 *
 * So neither. `deserializeDatabaseAsync` opens the backup's bytes — which are
 * already in memory, having just been read and checksummed — as a database in
 * its own right, and `backupDatabaseAsync` is SQLite's Online Backup API, which
 * copies one open connection's contents over another's. No file is written, no
 * path is constructed, no connection is closed, and the question above stops
 * mattering because nothing asks it.
 *
 * @see https://www.sqlite.org/backup.html
 */

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

export type RestoreOutcome =
  /** The copy did not happen. Nothing on the phone changed. */
  | 'untouched'
  /** The copy ran, but the result does not match the backup. */
  | 'mismatch';

/**
 * Which part of a restore failed.
 *
 * Carried so the message can say where it broke. Both earlier failures of this
 * feature showed up as "the restore did not work", and narrowing each one down
 * cost a round trip to the phone. A restore opens a second database, migrates
 * it and copies it over the live one; which of those refused is the only
 * question worth asking first.
 */
export type RestoreStep = 'safety-copy' | 'open' | 'migrate' | 'copy' | 'count' | 'verify';

/** Plain-language detail, appended to the outcome. */
const STEP_DETAIL: Record<RestoreStep, string> = {
  'safety-copy': 'A safety copy of your current data could not be saved first.',
  open: 'The backup file could not be opened as a database.',
  migrate: 'The backup could not be brought up to date with this version of the app.',
  copy: 'The data could not be copied out of the backup.',
  count: 'The restored data could not be counted afterwards.',
  verify: 'The restored data did not match what the backup said it held.',
};

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

  /** Which part failed, so a report identifies itself without a stack trace. */
  readonly step: RestoreStep;

  /** Whether the shop's own data is intact. */
  readonly rolledBack: boolean;

  constructor(outcome: RestoreOutcome, step: RestoreStep, options?: { cause?: unknown }) {
    super(`${RESTORE_OUTCOME_MESSAGES[outcome]} ${STEP_DETAIL[step]}`, options);
    this.name = 'RestoreFailedError';
    this.outcome = outcome;
    this.step = step;
    this.rolledBack = outcome === 'untouched';
  }
}

/**
 * The steps a restore is made of, injected so the failure paths can be tested.
 *
 * Each one touches the live connection or a second database, neither of which
 * exists in a test — but what happens when one fails is the whole safety of the
 * operation, and untested recovery code is code that has never run.
 */
export type RestoreIo = {
  /** Keeps a copy of the current data, in case something unforeseen happens. */
  keepSafetyCopy: () => Promise<void>;
  /** Opens the backup's bytes as a database of their own. */
  openIncoming: (bytes: Uint8Array) => Promise<SQLiteDatabase>;
  /** Brings that database up to the current schema, if it is older. */
  migrateIncoming: (incoming: SQLiteDatabase) => Promise<void>;
  /** Copies it over the live database through SQLite's own backup API. */
  copyIn: (incoming: SQLiteDatabase) => Promise<void>;
  /** What the live database holds now. */
  countRows: () => Promise<BackupCounts>;
  closeIncoming: (incoming: SQLiteDatabase) => Promise<void>;
};

/** Runs one step, labelling anything it throws with where it happened. */
async function step<T>(name: RestoreStep, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RestoreFailedError) throw error;
    throw new RestoreFailedError('untouched', name, { cause: error });
  }
}

/**
 * Replaces the shop's data with a backup's.
 *
 * The counts are checked against the manifest afterwards, and that check is not
 * ceremony: an earlier implementation reported success while changing nothing,
 * and passed its own verification because all that proved was that the database
 * could still be read. A restore that did not restore has to fail loudly, or
 * the owner finds out when they need the data.
 */
export async function performRestore(
  database: Uint8Array,
  manifest: BackupManifest,
  io: RestoreIo
): Promise<void> {
  await step('safety-copy', () => io.keepSafetyCopy());

  const incoming = await step('open', () => io.openIncoming(database));

  try {
    await step('migrate', () => io.migrateIncoming(incoming));
    await step('copy', () => io.copyIn(incoming));

    const after = await step('count', () => io.countRows());
    if (
      after.products !== manifest.counts.products ||
      after.bills !== manifest.counts.bills ||
      after.billItems !== manifest.counts.billItems
    ) {
      throw new RestoreFailedError('mismatch', 'verify');
    }
  } finally {
    // Left open, this is a whole copy of the shop's data held in memory.
    await io.closeIncoming(incoming).catch(() => undefined);
  }
}

/** Where the pre-restore safety copy goes. Outside `backups/`, so pruning never takes it. */
const SAFETY_DIRECTORY_NAME = 'restore-safety';

export const SAFETY_COPY_NAME = `before-restore${BACKUP_FILE_EXTENSION}`;

function safetyDirectory(): Directory {
  return new Directory(Paths.document, SAFETY_DIRECTORY_NAME);
}

/** Offsets 18 and 19 of a SQLite file: the write and read format versions. */
const HEADER_WRITE_VERSION = 18;
const HEADER_READ_VERSION = 19;
const JOURNAL_ROLLBACK = 1;
const JOURNAL_WAL = 2;

/**
 * Clears the WAL flag in a backup's header, in place.
 *
 * The live database runs in WAL mode, and a database's journal mode is recorded
 * in its own header — so every backup this app has ever written carries a WAL
 * header, `wal_checkpoint(TRUNCATE)` notwithstanding. The checkpoint flushes the
 * log; it does not change the mode.
 *
 * A restore deserialises those bytes into an **in-memory** database, and SQLite
 * cannot run one of those in WAL mode: WAL needs a `-wal` file beside a database
 * that, by construction, has no path. The first statement against it fails with
 * SQLITE_CANTOPEN — surfacing as *"unable to open database file"*, which reads
 * like a missing file and is really a mode the database cannot honour.
 *
 * Two bytes fix it. This is what SQLite itself writes when a database is taken
 * out of WAL mode, and it is safe precisely because the backup was checkpointed
 * before it was serialised: every committed page is already in the main file,
 * so there is no log content to lose. It also repairs backups already sitting in
 * the owner's Drive, which a fix applied at write time would not.
 *
 * Copies rather than writing in place, and the copy is not optional.
 * `decodeBackup` returns the payload as a `subarray` — a *view* over the bytes
 * read from the file, not a region of its own — so patching it in place reaches
 * back through the view and edits the backup itself. The checksum is computed
 * over those same bytes, so the next read of that file then rejects it as
 * damaged: an undo that silently destroyed the copy it was meant to restore.
 * Caught by restoring one file twice. Two bytes are not worth that.
 */
export function useRollbackJournal(bytes: Uint8Array): Uint8Array {
  if (bytes.length <= HEADER_READ_VERSION) return bytes;
  if (bytes[HEADER_WRITE_VERSION] !== JOURNAL_WAL && bytes[HEADER_READ_VERSION] !== JOURNAL_WAL) {
    return bytes;
  }

  const copy = bytes.slice();
  copy[HEADER_WRITE_VERSION] = JOURNAL_ROLLBACK;
  copy[HEADER_READ_VERSION] = JOURNAL_ROLLBACK;
  return copy;
}

/**
 * The copy taken just before the last restore, if there is one.
 *
 * This file is written by every restore and read by nothing else, which for one
 * release meant it was insurance nobody could claim: it sits outside `backups/`
 * so pruning cannot take it, and that also keeps it out of `listBackups`, while
 * the only other way into a restore is the system file picker — which does not
 * show the app's own scoped directory. A safety net that cannot be reached from
 * the screen is not a safety net.
 *
 * Returns null when no restore has ever run on this phone, which is the normal
 * state and not an error. The caller shows the undo only when there is
 * something to undo.
 */
export function findSafetyCopy(): File | null {
  const directory = safetyDirectory();
  if (!directory.exists) return null;

  const file = new File(directory, SAFETY_COPY_NAME);
  return file.exists ? file : null;
}

/** Builds the real steps, bound to the connection that is open right now. */
export function sqliteRestoreIo(db: SQLiteDatabase = getDatabase()): RestoreIo {
  return {
    keepSafetyCopy: async () => {
      // An ordinary backup, in the ordinary format, so that if it is ever
      // needed it can be restored through this same flow rather than by hand.
      // This is the one part of a restore that does touch a file — and it only
      // writes, into the same directory the backup feature already writes to.
      const directory = safetyDirectory();
      if (!directory.exists) directory.create({ intermediates: true });

      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
      const bytes = await db.serializeAsync();

      const manifest: BackupManifest = {
        format: FORMAT_VERSION,
        app: 'mahale-phones-electronics',
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        schemaVersion: await getSchemaVersion(db),
        createdAt: new Date().toISOString(),
        shopName: await shopNameFor(db),
        databaseBytes: bytes.length,
        checksum: checksum(bytes),
        counts: await countAllRows(db),
      };

      const file = new File(directory, SAFETY_COPY_NAME);
      if (file.exists) file.delete();
      file.create();
      file.write(encodeBackup(bytes, manifest));
    },

    // The bytes are already in memory — they were read and checksummed a moment
    // ago — so this needs no file, no path and no directory. They do need their
    // journal mode neutralised first; see below.
    openIncoming: (bytes) => SQLite.deserializeDatabaseAsync(useRollbackJournal(bytes)),

    migrateIncoming: async (incoming) => {
      // Off while the schema is being brought forward: an older backup may hold
      // rows a newer constraint would reject mid-migration, and this database is
      // a copy being prepared, not the shop's live data.
      await incoming.execAsync('PRAGMA foreign_keys = OFF;');
      await runMigrations(incoming);
    },

    // SQLite's Online Backup API, between two open connections. The live
    // database's contents are replaced by the copy's, page by page, inside a
    // transaction the API manages — so a failure part way leaves the
    // destination as it was rather than half-written.
    copyIn: async (incoming) => {
      await SQLite.backupDatabaseAsync({ sourceDatabase: incoming, destDatabase: db });

      // The source was deliberately put into rollback-journal mode above, and
      // a page-for-page copy includes page 1, which is where the journal mode
      // lives. Whether the backup API carries that across to the destination or
      // preserves the destination's own mode is not something the docs settle,
      // so rather than depend on the answer, WAL is simply asked for again.
      // Costless if it was never lost.
      //
      // Best-effort: the data is already in by this point, and refusing an
      // otherwise good restore over a performance setting would be the wrong
      // trade. `initDatabase` sets WAL on every open, so it self-heals on the
      // next app start regardless.
      try {
        await db.execAsync("PRAGMA journal_mode = 'wal';");
      } catch (error) {
        console.warn('[backup] could not restore WAL mode after a restore:', error);
      }
    },

    countRows: () => countAllRows(db),

    closeIncoming: (incoming) => incoming.closeAsync(),
  };
}

/**
 * The whole flow: read the file, check it, then copy it in.
 *
 * Validation runs again here even though the screen has already previewed the
 * file. The preview and the restore are separated by however long the owner
 * spends reading the confirmation.
 *
 * The order of the first two lines is load-bearing when the file being restored
 * IS the safety copy — the undo. `inspectBackup` reads the whole file into
 * memory before `performRestore` runs, and `keepSafetyCopy` is the first thing
 * `performRestore` does, overwriting that same file. Reading first means the
 * undo is working from bytes it already holds, so overwriting the file it came
 * from cannot pull the ground out from under it. Do not make this lazy.
 */
export async function restoreBackup(
  uri: string,
  io: RestoreIo = sqliteRestoreIo()
): Promise<BackupManifest> {
  const { manifest, database } = await inspectBackup(uri);
  await performRestore(database, manifest, io);
  return manifest;
}
