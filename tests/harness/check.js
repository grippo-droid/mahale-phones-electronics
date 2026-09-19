'use strict';

/**
 * The assertion helper every suite shares.
 *
 * Deliberately tiny and deliberately not a framework. What these suites are for
 * is checking decisions that are easy to undo by accident, and the thing that
 * makes them useful is the LABEL — "a refusal is permanent", "no date is
 * invented" — read as a sentence when it fails. A framework would add
 * dependencies and a vocabulary without improving that.
 *
 * Comparison is by JSON, which is enough for the values here (numbers, strings,
 * small objects and arrays) and treats `undefined` and a missing key alike.
 * Anything needing more than that is a sign the check is testing too much.
 */

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');

function createChecker() {
  let checks = 0;
  const failures = [];

  function check(label, actual, expected) {
    checks += 1;
    if (JSON.stringify(actual) === JSON.stringify(expected)) return;
    failures.push({ label, actual, expected });
  }

  /** A heading in the output. Purely for reading a failure in context. */
  function section(title) {
    check.__sections.push({ title, at: checks });
  }
  check.__sections = [];

  return {
    check,
    section,
    result: () => ({ checks, failures, sections: check.__sections }),
  };
}

/** Reads a project file as text. Source-level checks are how screens are covered. */
function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/**
 * The same file with its comments removed.
 *
 * Use this for any check of the form "this file must NOT contain X". Three
 * separate checks have been caught matching the comment that EXPLAINS why X is
 * avoided — "never calls Alert.prompt" matched the note saying it is iOS-only,
 * and "spells no fallback of its own" matched the note explaining the fallback.
 * A check that passes because of prose is a check that is not testing the code.
 *
 * Deliberately naive: it does not understand a `//` inside a string literal.
 * That is fine for the question it answers, and a real parser would be a
 * dependency for no gain here.
 */
function readSourceWithoutComments(relativePath) {
  const NEWLINE = String.fromCharCode(10);
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(NEWLINE)
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join(NEWLINE);
}

/** A scratch directory for a suite that needs real files, removed afterwards. */
function tempDir(prefix) {
  return fs.mkdtempSync(path.join(require('node:os').tmpdir(), `mpe-${prefix}-`));
}

module.exports = { createChecker, readSource, readSourceWithoutComments, tempDir, ROOT };
