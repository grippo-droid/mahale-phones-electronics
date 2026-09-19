'use strict';
// T9.4 — adding a not-found product to Inventory without losing the bill.
//
// The handover is the part worth testing: a product handed over and never
// collected, or collected twice, or collected by the wrong screen, would put
// an item on a bill nobody put it on. The prompt itself and the round trip
// through the form are device work — there is no renderer here.
const { readSource } = require('../harness/check');
const { useNewProductStore } = require('@/store/newProduct');

const PRODUCT = { id: 7, name: 'Cat6 Cable', unit_price: 25, gst_rate: 18, stock_qty: 0 };
const OTHER = { id: 8, name: 'RO Filter', unit_price: 900, gst_rate: 18, stock_qty: 3 };
const state = () => useNewProductStore.getState();

async function run({ check, section }) {
  section('handing a product to the screen that asked');
  check('nothing waiting to begin with', state().pending, null);

  state().hand(PRODUCT, 'bill');
  check('the bill collects it', state().take('bill')?.id ?? null, 7);

  section('\nand it is cleared in the same call');
  // The danger with a slot like this is one left behind: a product handed over,
  // never collected, and added to an unrelated bill days later.
  check('nothing is left waiting', state().pending, null);
  check('a second collection gets nothing', state().take('bill'), null);

  section('\nthe wrong screen cannot take it');
  state().hand(PRODUCT, 'quotation');
  check('the bill does not collect a quotation handover', state().take('bill'), null);
  check('and it is still waiting for the one that asked', state().pending?.product.id ?? null, 7);
  check('which does collect it', state().take('quotation')?.id ?? null, 7);

  section('\na second handover replaces the first');
  state().hand(PRODUCT, 'bill');
  state().hand(OTHER, 'bill');
  check('only the newest is waiting', state().take('bill')?.id ?? null, 8);
  check('and nothing follows it', state().take('bill'), null);

  section('\nand it can be dropped without being used');
  state().hand(PRODUCT, 'bill');
  state().discard();
  check('discard clears it', state().take('bill'), null);

  section('\nthe screens carry the typed name into the form');
  for (const [name, file, target] of [
    ['Billing', 'app/(tabs)/billing.tsx', 'bill'],
    ['Quotation editor', 'app/quotation/new.tsx', 'quotation'],
  ]) {
    const src = readSource(file);
    check(`${name} opens the real Add Product route`,
      /pathname: '\/inventory\/add'/.test(src), true);
    check(`${name} says who is asking`,
      new RegExp(`addTo: '${target}'`).test(src), true);
    check(`${name} pre-fills what was typed`,
      /name: debouncedSearch\.trim\(\)/.test(src), true);
    check(`${name} collects on focus`,
      new RegExp(`takeNewProduct\\('${target}'\\)`).test(src), true);
    check(`${name} asks how many before adding`,
      src.includes('<QuantityPrompt'), true);
    check(`${name} applies the answered quantity`,
      /setQty\(product\.id, qty\)/.test(src), true);
  }

  section('\nthe button is offered only when there is a name to carry');
  // Under a category chip with an empty search box there is nothing to name the
  // product, and a button opening a blank form is no better than the Inventory
  // tab's own.
  for (const [name, file] of [
    ['Billing', 'app/(tabs)/billing.tsx'],
    ['Quotation editor', 'app/quotation/new.tsx'],
  ]) {
    check(`${name} gates it on a typed term`,
      /\{(term|debouncedSearch)\.trim\(\) \? \(/.test(readSource(file)), true);
  }

  section('\nthe form itself is not cut down');
  // A product created mid-sale is a real product. One entered through a
  // shortened form would be missing its HSN code on the invoice it is about to
  // appear on.
  const add = readSource('app/inventory/add.tsx');
  check('the same ProductForm is used', add.includes('<ProductForm'), true);
  check('with no field list narrowing it', /fields=|only=|compact/.test(add), false);
  check('only the name is pre-filled',
    /\{ \.\.\.EMPTY_PRODUCT_FORM, name: params\.name \}/.test(add), true);
  check('and it hands the product over only when asked to',
    /if \(target\) hand\(created, target\)/.test(add), true);

  section('\nthe prompt is a Modal, never Alert.prompt');
  // Alert.prompt is iOS-only and does nothing at all on Android: it would have
  // shipped as a prompt that never appeared. Same trap the reset avoids.
  const prompt = readSource('components/QuantityPrompt.tsx');
  check('it renders a Modal', prompt.includes('<Modal'), true);
  // A CALL, not a mention: the comment above the component explains why
  // Alert.prompt is not used, and matching bare text flagged that prose.
  check('and never calls Alert.prompt', /Alert\.prompt\s*\(/.test(prompt), false);
  // The react-native import line itself, not the whole file: the comment
  // above the component explains why Alert.prompt is avoided, and a
  // whole-file search matched that prose instead of any code.
  const rnImport = prompt
    .split(String.fromCharCode(10))
    .find((line) => line.startsWith('import') && line.includes('react-native'));
  check('it does not even import Alert', rnImport.includes('Alert'), false);
  check('it refuses a quantity of zero', /qty <= 0/.test(prompt), true);
  check('it names what it is adding to', /target === 'bill'/.test(prompt), true);

}

module.exports = { run };
