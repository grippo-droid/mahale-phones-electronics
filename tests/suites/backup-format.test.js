'use strict';

/**
 * The backup file format: encoding, and every way a bad file is refused.
 *
 * ---------------------------------------------------------------------------
 * What this suite reaches, and what it does not.
 *
 * Reached, genuinely: the format itself. `encodeBackup`, `decodeBackup`, the
 * checksum, the hand-written UTF-8, and the WAL-header patch are all pure
 * functions over bytes, and a real database is serialised, encoded, decoded
 * and reopened here to prove the round trip.
 *
 * NOT reached: anything that touches a real filesystem — `createBackup`,
 * `listBackups`, pruning, `findSafetyCopy`, `inspectBackup` and
 * `restoreBackup`. The `expo-file-system` shim throws by design, so those are
 * device work and are not faked here. Nor is `sqliteRestoreIo`, the real
 * implementation of the restore steps; its ORDERING is covered in
 * restore-safety.test.js through the injected seam, which is the reason that
 * seam exists.
 *
 * Restoring is the one unrecoverable thing this app can do, and both of its
 * device failures were invisible to an earlier harness. A green run here is
 * not a statement that a restore works on a phone.
 * ---------------------------------------------------------------------------
 */

const { tempDir } = require('../harness/check');
const {
  encodeBackup,
  decodeBackup,
  checksum,
  utf8Encode,
  utf8Decode,
  useRollbackJournal,
  backupFileName,
  BackupFormatError,
} = require('@/db/backup');
const { initDatabase } = require('@/db/init');
const { LATEST_SCHEMA_VERSION } = require('@/db/schema');
const products = require('@/db/products');
const SQLite = require('expo-sqlite');

/** Bytes 18 and 19 of a SQLite header: write version and read version. */
const HEADER_WRITE_VERSION = 18;
const HEADER_READ_VERSION = 19;
const JOURNAL_WAL = 2;
const JOURNAL_ROLLBACK = 1;

function manifestFor(database, extra = {}) {
  return {
    format: 1,
    appVersion: '1.0.0',
    schemaVersion: LATEST_SCHEMA_VERSION,
    createdAt: '2026-09-19T00:00:00.000Z',
    shopName: 'Mahale Phones And Electronics',
    databaseBytes: database.length,
    checksum: checksum(database),
    counts: { products: 1, bills: 0, billItems: 0, settings: 0, quotations: 0, billPayments: 0 },
    ...extra,
  };
}

function refusalFrom(bytes) {
  try {
    decodeBackup(bytes);
    return null;
  } catch (error) {
    return error instanceof BackupFormatError ? error.message : `WRONG TYPE: ${error}`;
  }
}

const newProduct = (name) => ({
  name,
  category: 'Other',
  stock_qty: 7,
  unit_price: 100,
  gst_rate: 0,
  hsn_code: null,
  brand: null,
  model_number: null,
  low_stock_threshold: null,
  price_includes_gst: false,
  purchase_price: null,
});

async function run({ check, section }) {
  section('a real database survives the round trip');
  // The format is only known to be readable if something reads it back. The
  // suite serialises a database, encodes it, decodes it, and opens the payload
  // as a database again — the same path a restore takes before it copies in.
  const db = await initDatabase({ directory: tempDir('backup') });
  await products.createProduct(newProduct('Hikvision Dome'), db);

  const serialised = await db.serializeAsync();
  const file = encodeBackup(serialised, manifestFor(serialised));
  const parsed = decodeBackup(file);

  check('the manifest comes back', parsed.manifest.shopName, 'Mahale Phones And Electronics');
  check('and the payload is the same bytes', parsed.database.length, serialised.length);

  const reopened = await SQLite.deserializeDatabaseAsync(parsed.database);
  const rows = await reopened.getAllAsync('SELECT name FROM products ORDER BY name');
  check('the shop reads back out of it', rows.map((r) => r.name), ['Hikvision Dome']);
  await reopened.closeAsync();

  section('the header is human-readable, which is the point of the format');
  // The first two lines can be read by opening the file in any text editor,
  // which matters when the owner is in another city and something has gone
  // wrong. No zip and no base64, for that reason.
  const firstBreak = file.indexOf(0x0a);
  check('the first line names the format',
    utf8Decode(file.subarray(0, firstBreak)), 'MAHALE-BACKUP/1');
  const secondBreak = file.indexOf(0x0a, firstBreak + 1);
  const headerJson = JSON.parse(utf8Decode(file.subarray(firstBreak + 1, secondBreak)));
  check('the second is the manifest, as plain JSON', headerJson.schemaVersion, LATEST_SCHEMA_VERSION);

  section('every refusal, in the order that gives the most useful message');
  // Everything rejected here is something a restore must never be handed.
  // Overwriting the shop's live data with a half-copied file is the one
  // unrecoverable thing this app can do.
  check('a file that is not ours',
    refusalFrom(utf8Encode('hello there\nand more\n')),
    'This file is not a Mahale backup.');
  check('a file with no line breaks at all',
    refusalFrom(utf8Encode('MAHALE-BACKUP/1')),
    'This file is not a Mahale backup.');

  const newerFormat = encodeBackup(serialised, manifestFor(serialised));
  const bumped = utf8Encode('MAHALE-BACKUP/99\n');
  const withNewerFormat = new Uint8Array(bumped.length + (newerFormat.length - firstBreak - 1));
  withNewerFormat.set(bumped, 0);
  withNewerFormat.set(newerFormat.subarray(firstBreak + 1), bumped.length);
  check('a format from a newer app says so, and says what to do',
    /newer version of the app \(backup format 99\)/.test(refusalFrom(withNewerFormat)), true);

  const noManifest = utf8Encode('MAHALE-BACKUP/1\n');
  check('a file that stops after the magic line',
    refusalFrom(noManifest),
    'This backup file is incomplete — it has no details block.');

  const badJson = utf8Encode('MAHALE-BACKUP/1\n{not json\n');
  check('a manifest that will not parse',
    refusalFrom(badJson),
    'This backup file is damaged — its details cannot be read.');

  // The realistic failure: an interrupted share, or a cloud sync that stopped
  // half way.
  const truncated = file.subarray(0, file.length - 200);
  check('a file that did not finish copying says how far it got',
    /holds \d+ bytes of \d+/.test(refusalFrom(truncated)), true);

  const damaged = file.slice();
  damaged[damaged.length - 5] ^= 0xff;
  check('a file with a flipped byte',
    refusalFrom(damaged),
    'This backup file is damaged and cannot be restored.');

  const notADatabase = encodeBackup(utf8Encode('x'.repeat(64)), manifestFor(utf8Encode('x'.repeat(64))));
  check('a payload that is not a database at all',
    refusalFrom(notADatabase),
    'This backup file does not contain a database.');

  const fromFuture = encodeBackup(
    serialised,
    manifestFor(serialised, { schemaVersion: LATEST_SCHEMA_VERSION + 1 })
  );
  // The same rule db/init.ts applies to the live database: old code must not
  // run against a schema written by a newer build.
  check('data from a newer build is refused, not migrated backwards',
    /newer version of the app \(data version/.test(refusalFrom(fromFuture)), true);

  section('and a good file is not refused for any of those reasons');
  check('it decodes', refusalFrom(file), null);

  section('the checksum catches damage, and claims nothing more');
  // FNV-1a. It catches a truncated or mangled file, which is the realistic
  // failure. It proves nothing about WHO wrote the file and cannot: anyone
  // editing a backup can recompute it.
  check('the same bytes give the same sum', checksum(serialised), checksum(serialised));
  const nudged = serialised.slice();
  nudged[10] ^= 0x01;
  check('one flipped bit changes it', checksum(nudged) !== checksum(serialised), true);

  section('UTF-8 is encoded by hand, so it matches everywhere');
  // The manifest carries a byte count the decoder checks, so the encoding has
  // to be the same everywhere rather than whatever the runtime provides.
  const samples = ['Ramesh', 'Mahale Phones And Electronics', '₹1,180.00', 'शर्मा', '𝄞 clef'];
  for (const text of samples) {
    const encoded = utf8Encode(text);
    const node = new Uint8Array(Buffer.from(text, 'utf8'));
    check(`"${text}" matches Node's encoder`, Array.from(encoded), Array.from(node));
    check(`"${text}" round-trips`, utf8Decode(encoded), text);
  }
  // An unpaired surrogate must not produce invalid UTF-8.
  const lone = utf8Encode(String.fromCharCode(0xd800));
  check('an unpaired surrogate becomes U+FFFD', utf8Decode(lone), '�');

  section('the WAL flag is cleared, and the original is never touched');
  // A restore opens the bytes as an IN-MEMORY database, and SQLite cannot run
  // one of those in WAL mode: WAL needs a -wal file beside a database that by
  // construction has no path. The first statement fails SQLITE_CANTOPEN, which
  // surfaces as "unable to open database file" and reads like a missing file.
  // Every backup this app has ever written carries a WAL header, and these are
  // the real serialised bytes rather than a constructed example. The
  // wal_checkpoint before serialising flushes the LOG; it does not change the
  // MODE, which is recorded in the database's own header.
  check('a real backup carries a WAL header to begin with',
    serialised[HEADER_WRITE_VERSION], JOURNAL_WAL);

  const walBytes = serialised;
  const patched = useRollbackJournal(walBytes);
  check('the write version is cleared', patched[HEADER_WRITE_VERSION], JOURNAL_ROLLBACK);
  check('and the read version', patched[HEADER_READ_VERSION], JOURNAL_ROLLBACK);
  check('the source is left alone', walBytes[HEADER_WRITE_VERSION], JOURNAL_WAL);

  // Nothing to do, so nothing is copied — the same reference comes back.
  const alreadyRollback = serialised.slice();
  alreadyRollback[HEADER_WRITE_VERSION] = JOURNAL_ROLLBACK;
  alreadyRollback[HEADER_READ_VERSION] = JOURNAL_ROLLBACK;
  check('a database already in rollback mode is returned unchanged',
    useRollbackJournal(alreadyRollback) === alreadyRollback, true);

  section('and patching must never reach back into the file');
  // decodeBackup returns the payload as a subarray — a VIEW over the bytes read
  // from the file, not a region of its own. Patched in place, the edit reaches
  // back through the view into the backup itself; the checksum covers those
  // same bytes, so the next read rejects that file as damaged. An undo that
  // silently destroyed the copy it was restoring. Found by restoring one file
  // twice.
  // A pristine copy, independent of the checks above. Under a negative control
  // that patches in place, the earlier call mutates `serialised` itself — and
  // a file built from the already-patched bytes has nothing left to corrupt,
  // so the checks below would quietly stop testing anything.
  const pristine = serialised.slice();
  pristine[HEADER_WRITE_VERSION] = JOURNAL_WAL;
  pristine[HEADER_READ_VERSION] = JOURNAL_WAL;
  const walFile = encodeBackup(pristine, manifestFor(pristine));
  const decoded = decodeBackup(walFile);
  const before = Array.from(walFile);

  useRollbackJournal(decoded.database);

  check('the file bytes are untouched by the patch', Array.from(walFile), before);
  check('so the very same file still decodes a second time',
    refusalFrom(walFile), null);

  section('a backup is named so the newest sorts last');
  // Pruning keeps the newest three BY FILENAME, which carries the phone's
  // clock, so the name has to sort chronologically.
  const early = backupFileName(new Date('2026-01-02T03:04:05.000Z'));
  const later = backupFileName(new Date('2026-11-12T13:14:15.000Z'));
  check('it ends with the backup extension', early.endsWith('.mpebak'), true);
  check('and they sort in order', [early, later].sort(), [early, later]);
}

module.exports = { run };
