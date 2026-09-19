'use strict';

/**
 * The data-layer rules that are easiest to undo by accident: LIKE escaping,
 * invoice numbering, the reset's counters, and the unit column's no-backfill.
 *
 * NOTE: a rebuild, not a restoration. The original suites (likesearch, invoice,
 * reset, units) were lost with the scratchpad harness; these were written
 * afresh from the decisions in CLAUDE.md. Same rules, different assertions, and
 * none of the original negative controls.
 */

const { tempDir, readSource } = require('../harness/check');
const { initDatabase } = require('@/db/init');
const bills = require('@/db/bills');
const products = require('@/db/products');
const { resetShopData } = require('@/db/reset');
const { likeTerm, likeClause, LIKE_ESCAPE_SQL } = require('@/lib/likeSearch');
const { formatQuantityWithUnit, BILL_UNITS } = require('@/lib/units');
const { renderInvoiceNumber, periodFor, financialYearLabel } = require('@/lib/invoiceNumber');

const newProduct = (name, extra = {}) => ({
  name,
  category: 'Other',
  stock_qty: 10,
  unit_price: 100,
  gst_rate: 0,
  hsn_code: null,
  brand: null,
  model_number: null,
  low_stock_threshold: null,
  price_includes_gst: false,
  purchase_price: null,
  ...extra,
});

function billFor(invoice, extra = {}) {
  return {
    invoice_number: invoice,
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    customer_state: 'Madhya Pradesh',
    subtotal: 100, cgst_total: 0, sgst_total: 0, igst_total: 0, grand_total: 100,
    items: [{
      product_id: null, product_name_snapshot: 'Cable', hsn_code_snapshot: null,
      qty: 1, unit: null, unit_price_snapshot: 100, gst_rate_snapshot: 0,
      taxable_value: 100, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, line_total: 100,
    }],
    ...extra,
  };
}

async function run({ check, section }) {
  section('the LIKE escape has exactly one definition');
  // The correct code LOOKS wrong: the escape character is a single backslash,
  // so the clause reads as under-escaped and the instinctive "fix" doubles it —
  // which emits two characters and makes SQLite reject the whole statement. It
  // then fails only when a search term is present, so everything else works and
  // it ships green. This shipped twice.
  check('the clause carries a single escape character',
    (LIKE_ESCAPE_SQL.match(/\\/g) || []).length, 1);

  const files = ['db/bills.ts', 'db/products.ts', 'db/quotations.ts', 'db/settings.ts', 'db/reset.ts'];
  for (const file of files) {
    const source = readSource(file);
    const handwritten = /ESCAPE '/.test(source) && !file.endsWith('likeSearch.ts');
    check(`${file} does not spell the clause itself`, handwritten, false);
  }
  // An ESLint no-restricted-syntax rule enforces the same thing, which is the
  // stronger guard — this is here so the rule's removal is also noticed.
  check('and a lint rule refuses it too',
    readSource('eslint.config.js').includes('no-restricted-syntax'), true);

  section('a wildcard in a customer name cannot match every bill');
  const db = await initDatabase({ directory: tempDir('rules') });
  await bills.createBill(billFor('R-1', { customer_name: '100% Traders' }), db);
  await bills.createBill(billFor('R-2', { customer_name: 'Ramesh' }), db);

  const percent = await bills.listBills({ search: '100%' }, db);
  check('"100%" finds only the one shop', percent.length, 1);
  check('and it is the right one', percent[0].customer_name, '100% Traders');

  const underscore = await bills.listBills({ search: 'R_1' }, db);
  check('an underscore is not a single-character wildcard', underscore.length, 0);

  check('likeTerm wraps and escapes', likeTerm('100%'), '%100\\%%');
  check('likeClause ORs the columns it is given',
    likeClause(['a', 'b']).includes(' OR '), true);

  section('a unit is never invented for a line that has none');
  // NULL means no unit was chosen, which is the truth for every bill raised
  // before the column existed. A default of 'Pieces' would reprint years-old
  // invoices with a claim nobody made at the time.
  check('no unit prints the bare number', formatQuantityWithUnit(9, null), '9');
  check('an unknown word prints the bare number too', formatQuantityWithUnit(9, 'Crates'), '9');
  check('a real unit prints its short form', formatQuantityWithUnit(9, 'Meter'), '9 Mtr');
  check('there are exactly four', BILL_UNITS.length, 4);

  section('the reset clears the invoice counters, which is the point of it');
  // reserveInvoiceNumber reads invoice_seq:<period> BEFORE falling back to the
  // configured starting number, so deleting only rows would leave the series
  // continuing from wherever testing got to. Clearing bills without clearing
  // counters is not a partial reset; it is a broken one.
  await products.createProduct(newProduct('Cable'), db);
  await db.runAsync(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('invoice_seq:fy-2026-27', '153', ?)",
    new Date().toISOString()
  );

  const summary = await resetShopData(db);
  check('the bills go', (await bills.listBills({}, db)).length, 0);
  check('the products go', (await products.listProducts({}, db)).length, 0);
  check('and it says what it removed', summary.bills >= 2, true);

  const counters = await db.getAllAsync(
    "SELECT key FROM app_settings WHERE key LIKE 'invoice\\_seq:%' ESCAPE '\\'"
  );
  check('and every invoice counter goes with them', counters.length, 0);

  section('but the shop’s own details are kept');
  // Name, GSTIN, address and the invoice format are configuration, not data.
  // Losing them means retyping a GSTIN by hand, which is its own source of
  // error. Everything removed is a row the owner created and can recreate.
  await db.runAsync(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('business.gstin', '23ALYPM5121B1ZA', ?)",
    new Date().toISOString()
  );
  await resetShopData(db);
  const gstin = await db.getFirstAsync(
    "SELECT value FROM app_settings WHERE key = 'business.gstin'");
  check('the GSTIN survives a reset', gstin?.value ?? null, '23ALYPM5121B1ZA');

  section('the invoice format must carry a token matching its reset period');
  // A format whose token cannot tell two periods apart will hand the same
  // number to two customers. {YYYY} with a financial-year reset is exactly that:
  // the sequence restarts on 1 April while the token only changes on 1 January.
  check('the financial year is the period key',
    periodFor(new Date('2026-06-01'), 'financial-year').key, 'fy-2026-27');
  check('and it moves with 1 April',
    periodFor(new Date('2027-06-01'), 'financial-year').key, 'fy-2027-28');
  // 31 March belongs to the year that is closing, not the one starting.
  check('a date just before 1 April is in the closing year',
    financialYearLabel(new Date('2026-03-31')), '2025-26');

  check('the number pads to four digits',
    renderInvoiceNumber('MPE/{FY}/{SEQ}', 151, new Date('2026-06-01')), 'MPE/2026-27/0151');
  check('and a backdated bill resumes the closed year',
    renderInvoiceNumber('MPE/{FY}/{SEQ}', 1, new Date('2026-03-31')), 'MPE/2025-26/0001');
}

module.exports = { run };
