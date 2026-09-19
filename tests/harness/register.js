'use strict';

/**
 * Module resolution for the test harness.
 *
 * Two jobs:
 *
 *   1. `@/db/bills` → `<repo>/db/bills.ts`. The project uses that alias and tsc
 *      leaves it in the emitted code, so it has to be resolved at load time.
 *      The extension has to be added too: Node's resolver tries `.js`, `.json`
 *      and `.node`, never `.ts`.
 *
 *   2. `expo-sqlite` and friends → the shims in `./shims`. Mapped here rather
 *      than dropped into `node_modules`, where the next `npm install` would
 *      delete them — which is close to how the previous harness was lost.
 *
 * `registerHooks` rather than patching `Module._resolveFilename`, because the
 * source files use `import` syntax: Node reads them as ES modules and resolves
 * their specifiers through the ESM resolver, which a CommonJS hook never sees.
 * `registerHooks` is synchronous, in-thread, and covers both.
 *
 * There is NO build step. Node requires `.ts` directly, stripping the types, so
 * the suites run against the real source. The previous harness compiled to
 * CommonJS first and that copy going stale was a standing hazard — every change
 * meant remembering to recompile, and a forgotten recompile shows up as a test
 * passing against code that no longer exists.
 */

const path = require('node:path');
const fs = require('node:fs');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const SHIM_DIR = path.join(__dirname, 'shims');

/** Bare specifiers answered by a shim instead of by node_modules. */
const SHIMMED = new Set(
  fs
    .readdirSync(SHIM_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.slice(0, -'.js'.length))
);

function withExtension(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function asUrl(filePath) {
  return { url: pathToFileURL(filePath).href, shortCircuit: true };
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (SHIMMED.has(specifier)) {
      return asUrl(path.join(SHIM_DIR, `${specifier}.js`));
    }

    if (specifier.startsWith('@/')) {
      const resolved = withExtension(path.join(ROOT, specifier.slice(2)));
      if (resolved) return asUrl(resolved);
    }

    // A relative import from inside a .ts file, which also needs the extension
    // filling in — `./units` from `lib/pdf.ts`, for instance.
    if (specifier.startsWith('.') && context.parentURL) {
      const parentDir = path.dirname(new URL(context.parentURL).pathname);
      // Windows paths arrive with a leading slash on the drive letter.
      const cleaned = process.platform === 'win32' ? parentDir.replace(/^\//, '') : parentDir;
      const resolved = withExtension(path.resolve(decodeURIComponent(cleaned), specifier));
      if (resolved) return asUrl(resolved);
    }

    return nextResolve(specifier, context);
  },
});

module.exports = { ROOT, SHIM_DIR, SHIMMED };
