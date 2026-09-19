'use strict';

/**
 * One loader per screen, not two (T7.4).
 *
 * Scope, stated plainly: five of the six `set-state-in-effect` fixes are
 * guarded by `npm run lint`, which is a real test and a better one than
 * anything here — the rule reads the code as React sees it, where this file can
 * only read text. They are NOT re-checked here; a weaker copy of a check that
 * already exists is worse than no copy, because it looks like coverage.
 *
 * What lint does NOT catch is the sixth: a plain `useEffect` calling the same
 * loader a `useFocusEffect` already calls. That is legal React and silent — it
 * just runs every query twice, on every keystroke and every chip. It was in
 * Inventory, Billing and the quotation editor at once, and History had already
 * decided against it. So it is the one worth a guard.
 */

const { readSource } = require('../harness/check');

/** Every dependency array belonging to a plain `useEffect`, as written. */
function effectDeps(source) {
  const deps = [];
  const re = /useEffect\(/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    // Walk to the matching close paren, so a nested call cannot end it early.
    let depth = 0;
    let i = match.index + 'useEffect'.length;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const call = source.slice(match.index, i);
    const tail = call.lastIndexOf('[');
    if (tail !== -1) deps.push(call.slice(tail, call.lastIndexOf(']') + 1));
  }
  return deps;
}

const SCREENS = [
  ['Inventory', 'app/(tabs)/inventory.tsx', 'load'],
  ['Billing', 'app/(tabs)/billing.tsx', 'loadResults'],
  ['Quotation editor', 'app/quotation/new.tsx', 'loadResults'],
  ['History', 'app/(tabs)/history.tsx', 'loadFirstPage'],
  ['Quotations', 'app/(tabs)/quotations.tsx', 'load'],
];

async function run({ check, section }) {
  section('the loader a focus effect already runs is not also run by a plain effect');
  for (const [name, file, loader] of SCREENS) {
    const source = readSource(file);
    check(`${name} loads on focus`,
      new RegExp(`useFocusEffect\\([\\s\\S]{0,200}?\\b${loader}\\(`).test(source), true);
    check(`${name} has no plain effect on ${loader}`,
      effectDeps(source).some((deps) => new RegExp(`\\[\\s*${loader}\\s*[,\\]]`).test(deps)),
      false);
  }

  section('and the deferral that used to hide one is gone');
  // Billing and the quotation editor deferred the duplicate by a microtask to
  // keep the lint rule quiet. That silenced the warning and kept the second
  // query — the fix was to delete the effect, not to reschedule it.
  for (const [name, file] of [
    ['Billing', 'app/(tabs)/billing.tsx'],
    ['Quotation editor', 'app/quotation/new.tsx'],
  ]) {
    check(`${name} does not defer a load by a microtask`,
      /await Promise\.resolve\(\);[\s\S]{0,120}?load/.test(readSource(file)), false);
  }

  section('the debounce timers are still plain effects, which is right');
  // Not everything belongs on focus. A debounce subscribes to a timer and
  // cleans it up — the thing effects are actually for.
  for (const [name, file] of SCREENS.map(([n, f]) => [n, f])) {
    const source = readSource(file);
    if (!source.includes('SEARCH_DEBOUNCE_MS')) continue;
    check(`${name} still debounces in an effect`,
      /useEffect\(\(\) => \{\s*const timer = setTimeout/.test(source), true);
  }
}

module.exports = { run };
