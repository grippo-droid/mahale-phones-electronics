'use strict';

/**
 * `expo-print`, stubbed.
 *
 * Rendering is native. What the suites check is the HTML that would be handed
 * to it, which `renderBillHtml` produces as a pure string — so nothing here
 * needs to work. `printAsync` throws rather than no-ops so that a suite
 * accidentally depending on printing fails instead of quietly passing.
 *
 * Note for anyone tempted to make this render: never call `printAsync({ uri })`
 * on Android in the real app. See CLAUDE.md — it double-resumes its coroutine
 * and crashes natively.
 */
const refuse = async () => {
  throw new Error('expo-print is not modelled in the harness.');
};

exports.printAsync = refuse;
exports.printToFileAsync = refuse;
