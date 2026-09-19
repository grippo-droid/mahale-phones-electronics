'use strict';

/**
 * Runs the suites in `tests/suites`, one process each.
 *
 *   npm test                 every suite
 *   npm test ledger          suites whose name contains "ledger"
 *
 * Each suite exports `async function run({ check, section })` and asserts
 * through `check`. No framework: see `harness/check.js` for why. Each runs in
 * its own process — see `run-one.js` for why that is not optional.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SUITE_DIR = path.join(__dirname, 'suites');
const RUN_ONE = path.join(__dirname, 'run-one.js');

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const filters = args.filter((arg) => !arg.startsWith('--'));

function main() {
  const files = fs
    .readdirSync(SUITE_DIR)
    .filter((name) => name.endsWith('.test.js'))
    .filter((name) => filters.length === 0 || filters.some((f) => name.includes(f)))
    .sort();

  if (files.length === 0) {
    console.log(filters.length ? `No suite matches ${filters.join(', ')}` : 'No suites found.');
    process.exit(1);
  }

  let totalChecks = 0;
  let totalFailures = 0;
  let broken = 0;

  for (const file of files) {
    const name = file.replace(/\.test\.js$/, '');
    const child = spawnSync(
      process.execPath,
      [
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--disable-warning=ExperimentalWarning',
        RUN_ONE,
        path.join(SUITE_DIR, file),
      ],
      { encoding: 'utf8' }
    );

    const line = (child.stdout || '').trim().split('\n').filter(Boolean).pop();
    let report = null;
    try {
      report = line ? JSON.parse(line) : null;
    } catch {
      report = null;
    }

    if (!report || report.error) {
      broken += 1;
      console.log(`ERR  ${name}`);
      const detail = (report && report.error) || child.stderr || 'no output';
      console.log(
        detail
          .split('\n')
          .slice(0, 5)
          .map((l) => `       ${l}`)
          .join('\n')
      );
      continue;
    }

    totalChecks += report.checks;
    totalFailures += report.failures.length;

    const status = report.failures.length === 0 ? 'ok  ' : 'FAIL';
    console.log(`${status} ${name.padEnd(22)} ${report.checks - report.failures.length}/${report.checks}`);
    for (const failure of report.failures) {
      console.log(`       ✗ ${failure.label}`);
      console.log(`           expected ${JSON.stringify(failure.expected)}`);
      console.log(`           actual   ${JSON.stringify(failure.actual)}`);
    }
  }

  console.log(
    `\n${totalChecks - totalFailures}/${totalChecks} checks in ${files.length} suite(s)` +
      (broken ? `, ${broken} failed to run` : '')
  );
  process.exit(totalFailures > 0 || broken > 0 ? 1 : 0);
}

main();
