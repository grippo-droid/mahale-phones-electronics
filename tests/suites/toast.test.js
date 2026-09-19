'use strict';

/**
 * The confirmation banner (T7.3). The store is real logic and is driven here;
 * the call sites are source-level, since there is no renderer.
 */

const { readSource } = require('../harness/check');
const { useToastStore, showToast } = require('@/store/toast');

async function run({ check, section }) {
  const state = () => useToastStore.getState();

  section('the store');
  check('nothing showing to begin with', state().toast, null);

  showToast('Saved — Hikvision Dome');
  check('a message appears', state().toast?.message ?? null, 'Saved — Hikvision Dome');
  check('success is the default tone', state().toast?.tone ?? null, 'success');

  showToast('Could not save', 'error');
  check('an error tone can be asked for', state().toast?.tone ?? null, 'error');

  section('the same message twice still restarts it');
  showToast('Saved');
  const first = state().toast?.id ?? null;
  showToast('Saved');
  const second = state().toast?.id ?? null;
  check('the id changes even though the text did not', second !== first, true);

  section('a stale timer cannot clear a newer banner');
  // The bug the id guards against: the first toast's timer fires after a second
  // has replaced it, wiping the new message a moment after it appeared.
  state().dismiss(first);
  // Null-safe: a mutation that ignores the id clears the toast entirely, and
  // reading .id off null would crash the suite instead of failing one check —
  // which would hide every check after it.
  check('dismissing the old id leaves the new one alone', state().toast?.id ?? null, second);
  state().dismiss(second);
  check('dismissing the current id clears it', state().toast, null);

  state().dismiss();
  check('dismissing with no id is harmless when empty', state().toast, null);
  showToast('Anything');
  state().dismiss();
  check('and clears whatever is showing', state().toast, null);

  section('every action the owner asked to be confirmed');
  const sites = [
    ['adding a product', 'app/inventory/add.tsx', /showToast\(`Saved — \$\{product\.name/],
    ['saving a bill', 'app/(tabs)/billing.tsx', /showToast\(\s*editingBillId/],
    ['saving a quotation', 'app/quotation/new.tsx', /showToast\(\s*editingQuotationId/],
    ['taking a backup', 'app/(tabs)/settings.tsx', /showToast\(`Backup made/],
    ['restoring', 'app/(tabs)/settings.tsx', /showToast\(\s*`\$\{mode === 'undo'/],
    ['resetting shop data', 'app/(tabs)/settings.tsx', /showToast\(\s*`Cleared \$\{summary\.products/],
  ];
  for (const [what, file, pattern] of sites) {
    check(`${what} is confirmed`, pattern.test(readSource(file)), true);
  }

  section('it replaced dialogs rather than adding to them');
  const settings = readSource('app/(tabs)/settings.tsx');
  check('the restore success Alert is gone', /Alert\.alert\(\s*mode === 'undo'/.test(settings), false);
  check('the reset no longer has a "Done" modal step', settings.includes('resetDone'), false);

  section('the banner itself');
  const toast = readSource('components/Toast.tsx');
  check('it never takes a touch', toast.includes('pointerEvents="none"'), true);
  check('it sits above the tab bar', toast.includes('TAB_BAR_CLEARANCE'), true);
  check('it is announced to a screen reader',
    toast.includes('accessibilityLiveRegion="polite"'), true);
  check('its timer is keyed to the toast id', /\[id, dismiss\]/.test(toast), true);
  check('it is mounted once, in the root layout',
    readSource('app/_layout.tsx').includes('<Toast />'), true);
}

module.exports = { run };
