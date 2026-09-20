'use strict';

/**
 * `performRestore`: the order it does things in, and what it does when a step
 * fails.
 *
 * ---------------------------------------------------------------------------
 * Every step of a restore touches the filesystem or the live connection, and
 * neither exists here. The ordering and the failure handling ARE the safety of
 * the operation, though, and untested rollback code is code that has never run
 * — so the steps are injected (`RestoreIo`) and driven through a fake.
 *
 * That seam exists for this suite. It is the difference between checking the
 * dangerous path and hoping about it.
 *
 * What a green run here does NOT say: that a restore works on a phone. Both of
 * this feature's device failures — the close-and-swap that silently did
 * nothing, and the WAL header that could not be honoured in memory — lived
 * inside the real implementations of these steps, not in their ordering.
 * ---------------------------------------------------------------------------
 */

const { performRestore, RestoreFailedError } = require('@/db/backup');

const MANIFEST = {
  format: 1,
  appVersion: '1.0.0',
  schemaVersion: 10,
  createdAt: '2026-09-19T00:00:00.000Z',
  shopName: 'Mahale Phones And Electronics',
  databaseBytes: 4,
  checksum: 'x',
  counts: { products: 3, bills: 2, billItems: 5, settings: 4, quotations: 1, billPayments: 2 },
};

const BYTES = new Uint8Array([1, 2, 3, 4]);

/**
 * A fake set of steps that records what it was asked to do.
 *
 * `failAt` makes one step throw, which is how both rollback paths are reached.
 * `countsAfter` overrides what the live database claims to hold afterwards.
 */
function fakeIo({ failAt = null, countsAfter = MANIFEST.counts } = {}) {
  const calls = [];
  const incoming = { id: 'incoming-db' };

  const record = (name, value) => {
    calls.push(name);
    if (failAt === name) throw new Error(`${name} blew up`);
    return value;
  };

  return {
    calls,
    incoming,
    io: {
      keepSafetyCopy: async () => record('keepSafetyCopy'),
      openIncoming: async () => record('openIncoming', incoming),
      migrateIncoming: async () => record('migrateIncoming'),
      copyIn: async () => record('copyIn'),
      countRows: async () => record('countRows', countsAfter),
      closeIncoming: async () => record('closeIncoming'),
    },
  };
}

// Reads of the returned failure are null-safe throughout. A mutation that
// stops a failure happening at all would otherwise crash the suite on a
// property of null, hiding every check after it — the failure needs to be one
// red line, not a stack trace.
async function failureFrom(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    if (!(error instanceof RestoreFailedError)) return `WRONG TYPE: ${error}`;
    return { outcome: error.outcome, step: error.step, rolledBack: error.rolledBack };
  }
}

async function run({ check, section }) {
  section('the order, when everything works');
  const happy = fakeIo();
  await performRestore(BYTES, MANIFEST, happy.io);
  // The safety copy is FIRST. Everything after it can be undone from that file;
  // nothing before it can.
  check('every step ran, in order', happy.calls, [
    'keepSafetyCopy',
    'openIncoming',
    'migrateIncoming',
    'copyIn',
    'countRows',
    'closeIncoming',
  ]);

  section('the incoming copy is always closed');
  // Left open it is a whole second copy of the shop held in memory.
  for (const failAt of ['migrateIncoming', 'copyIn', 'countRows']) {
    const attempt = fakeIo({ failAt });
    await failureFrom(performRestore(BYTES, MANIFEST, attempt.io));
    check(`closed even when ${failAt} throws`,
      attempt.calls[attempt.calls.length - 1], 'closeIncoming');
  }

  section('a failure before the copy touches nothing');
  const earlyFail = fakeIo({ failAt: 'keepSafetyCopy' });
  const early = await failureFrom(performRestore(BYTES, MANIFEST, earlyFail.io));
  check('it says which step', early?.step ?? null, 'safety-copy');
  check('and that the shop is untouched', early?.outcome ?? null, 'untouched');
  check('which the caller can read directly', early?.rolledBack ?? null, true);
  // Nothing was opened, so nothing needs closing.
  check('no later step ran', earlyFail.calls, ['keepSafetyCopy']);

  const openFail = fakeIo({ failAt: 'openIncoming' });
  const opening = await failureFrom(performRestore(BYTES, MANIFEST, openFail.io));
  check('a backup that will not open is reported at that step', opening?.step ?? null, 'open');
  check('and still leaves the shop alone', opening?.outcome ?? null, 'untouched');
  check('with nothing to close', openFail.calls, ['keepSafetyCopy', 'openIncoming']);

  section('each step is named in what it throws');
  // Both device failures of this feature first showed as "the restore did not
  // work", and narrowing each one down cost a round trip to the phone.
  for (const [failAt, expected] of [
    ['migrateIncoming', 'migrate'],
    ['copyIn', 'copy'],
    ['countRows', 'count'],
  ]) {
    const attempt = fakeIo({ failAt });
    const failure = await failureFrom(performRestore(BYTES, MANIFEST, attempt.io));
    check(`${failAt} is reported as "${expected}"`, failure?.step ?? null, expected);
  }

  section('the counts are checked against the manifest, not against "it opens"');
  // An earlier implementation checked only that the tables could still be
  // queried afterwards — which a restore that changed nothing passes. It
  // reported success and the data was unchanged.
  const short = fakeIo({ countsAfter: { ...MANIFEST.counts, bills: 1 } });
  const mismatch = await failureFrom(performRestore(BYTES, MANIFEST, short.io));
  check('a restore that did not restore fails loudly', mismatch?.step ?? null, 'verify');
  check('and says the copy did happen', mismatch?.outcome ?? null, 'mismatch');
  // It committed, so the shop is NOT as it was — the caller must not offer the
  // "nothing changed" reassurance here.
  check('so the shop is not reported as untouched', mismatch?.rolledBack ?? null, false);
  check('the incoming copy is still closed',
    short.calls[short.calls.length - 1], 'closeIncoming');

  for (const table of ['products', 'billItems']) {
    const wrong = fakeIo({ countsAfter: { ...MANIFEST.counts, [table]: 999 } });
    const failure = await failureFrom(performRestore(BYTES, MANIFEST, wrong.io));
    check(`a wrong ${table} count is caught`, failure?.step ?? null, 'verify');
  }

  section('but a figure the file could not carry is not read as zero');
  // A backup written before quotations existed says nothing about them, and
  // "nothing" must not be read as "none" — that would fail every older backup
  // on this step.
  const olderManifest = { ...MANIFEST, counts: { ...MANIFEST.counts } };
  delete olderManifest.counts.quotations;
  delete olderManifest.counts.billPayments;

  const older = fakeIo({ countsAfter: { ...MANIFEST.counts, quotations: 7, billPayments: 9 } });
  check('an older backup restores even though those counts differ',
    await failureFrom(performRestore(BYTES, olderManifest, older.io)), null);

  // But when the file DOES carry the figure, it is checked.
  const carried = fakeIo({ countsAfter: { ...MANIFEST.counts, billPayments: 99 } });
  const carriedFailure = await failureFrom(performRestore(BYTES, MANIFEST, carried.io));
  check('a figure the file does carry is still verified', carriedFailure?.step ?? null, 'verify');
}

module.exports = { run };
