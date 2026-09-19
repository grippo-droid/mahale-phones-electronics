'use strict';

/**
 * Empty states and destructive confirmations (T7.1, T7.2).
 *
 * Source-level, because there is no renderer. What these catch is an empty
 * state or a confirmation being dropped, which is the realistic regression —
 * nobody removes one deliberately.
 */

const { readSource } = require('../harness/check');
const { useQuotationStore } = require('@/store/quotation');

async function run({ check, section }) {
  section('every list says something when it is empty');
  const lists = [
    ['Inventory', 'app/(tabs)/inventory.tsx'],
    ['History', 'app/(tabs)/history.tsx'],
    ['Quotations', 'app/(tabs)/quotations.tsx'],
    ['Quotation editor', 'app/quotation/new.tsx'],
  ];
  for (const [name, file] of lists) {
    check(`${name} has an empty state`,
      /ListEmptyComponent|emptyTitle/.test(readSource(file)), true);
  }
  check('Dashboard recent bills has one',
    readSource('app/(tabs)/dashboard.tsx').includes('No bills yet'), true);
  check('Billing says so for an empty bill',
    readSource('app/(tabs)/billing.tsx').includes('Nothing on this bill yet'), true);

  section('and the filtered lists tell the two cases apart');
  // "Nothing here" and "nothing matching THIS" need different words: the usual
  // reason something cannot be found is a filter left on from last time.
  check('Inventory distinguishes them',
    readSource('app/(tabs)/inventory.tsx').includes('isFiltered'), true);
  check('History distinguishes them',
    readSource('app/(tabs)/history.tsx').includes('isFiltered'), true);
  check('Quotations distinguishes them',
    /filtered\s*\?/.test(readSource('app/(tabs)/quotations.tsx')), true);

  section('every destructive action confirms first');
  const destructive = [
    ['deleting a product', 'app/inventory/[id].tsx', /Delete \$\{product\.name\}\?/],
    ['removing the logo', 'app/(tabs)/settings.tsx', /Remove the logo\?/],
    ['clearing the bill', 'app/(tabs)/billing.tsx', /Clear this bill\?/],
    ['deleting a bill', 'lib/billActions.ts', /Delete \$\{bill\.invoice_number\}\?/],
    ['deleting a quotation', 'lib/quotationActions.ts', /Delete \$\{quotation\.reference_number\}\?/],
    ['resetting shop data', 'app/(tabs)/settings.tsx', /Type RESET to confirm/],
    ['restoring a backup', 'app/(tabs)/settings.tsx', /Alert\.alert\(/],
    ['setting stock by hand', 'components/StockAdjuster.tsx', /Alert\.alert\(/],
    ['removing a payment', 'components/PaymentLedger.tsx', /Remove this payment\?/],
  ];
  for (const [what, file, pattern] of destructive) {
    check(`${what} asks first`, pattern.test(readSource(file)), true);
  }

  section('and generating a bill confirms what it will do to stock');
  const billing = readSource('app/(tabs)/billing.tsx');
  check('oversell is confirmed once, at the end',
    billing.includes('Stock will go negative'), true);
  check('a deleted product gets its own prompt',
    /A product was deleted|Some products were deleted/.test(billing), true);

  section('abandoning a quotation edit cannot overwrite it later');
  // The store outlives the screen, so backing out of an edit used to leave
  // editingQuotationId set — and "New Quotation" then reopened that edit,
  // overwriting the quotation the owner had walked away from.
  const store = useQuotationStore.getState();
  store.loadForEdit(
    [{ productId: 1, name: 'Cable', hsnCode: null, unitPrice: 100, gstRate: 18,
       priceIncludesGst: false, qty: 2, unit: 'Meter' }],
    { name: 'Ramesh', phone: '9', address: '' },
    42
  );
  check('the editor is in edit mode', useQuotationStore.getState().editingQuotationId, 42);

  // The real thing the button calls, not a re-implementation of it. An earlier
  // version of this check inlined the decision and so kept passing when the
  // guard was removed from the screen — caught by a negative control.
  store.beginNew();
  check('opening a new one drops the abandoned edit',
    useQuotationStore.getState().editingQuotationId, null);
  check('and does not carry its lines across',
    useQuotationStore.getState().lines.length, 0);

  section('but a genuine draft is kept');
  store.load(
    [{ productId: 1, name: 'Cable', hsnCode: null, unitPrice: 100, gstRate: 18,
       priceIncludesGst: false, qty: 2, unit: 'Meter' }],
    { name: '', phone: '', address: '' }
  );
  check('a draft has no quotation behind it',
    useQuotationStore.getState().editingQuotationId, null);
  store.beginNew();
  check('so it survives opening the editor', useQuotationStore.getState().lines.length, 1);

  const quotations = readSource('app/(tabs)/quotations.tsx');
  check('and the button says which it will do',
    quotations.includes('Continue quotation'), true);
  check('the screen calls the store rather than deciding itself',
    quotations.includes('beginNew()'), true);
  check('matching the Dashboard, which already did',
    readSource('app/(tabs)/dashboard.tsx').includes('Continue bill'), true);
}

module.exports = { run };
