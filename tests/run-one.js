'use strict';

/**
 * Runs ONE suite and prints its result as a single JSON line.
 *
 * Spawned per suite by `run.js` rather than all suites sharing a process,
 * because the things under test are module-level singletons: `db/init.ts`
 * memoises the open database and hands the same one to every later caller, and
 * every zustand store is created once per module load. Sharing a process meant
 * the quotations suite counting the ledger suite's bills — which looked like a
 * bug in the code rather than in the harness.
 */

require('./harness/register');

const path = require('node:path');
const { createChecker } = require('./harness/check');

async function main() {
  const file = process.argv[2];
  const { check, section, result } = createChecker();

  try {
    const suite = require(path.resolve(file));
    await suite.run({ check, section });
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ error: (error && error.stack) || String(error) })}\n`
    );
    process.exit(1);
  }

  const { checks, failures } = result();
  process.stdout.write(`${JSON.stringify({ checks, failures })}\n`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main();
