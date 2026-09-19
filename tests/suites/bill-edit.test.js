'use strict';

/**
 * Editing and deleting a bill (T5.8).
 *
 * NOTE: this is a rebuild, not a restoration. The original suite was lost with
 * the scratchpad harness; these checks were written afresh from the decisions
 * recorded in CLAUDE.md. They cover the same rules, but they are not the same
 * assertions, and any negative control the original carried is not here.
 */

const { tempDir } = require('../harness/check');
const { initDatabase } = require('@/db/init');
const bills = require('@/db/bills');
const products = require('@/db/products');

function line(product, qty) {
  return {
    product_id: product.id,
    product_name_snapshot: product.name,
    hsn_code_snapshot: product.hsn_code,
    qty,
    unit: null,
    unit_price_snapshot: product.unit_price,
    gst_rate_snapshot: 0,
    taxable_value: product.unit_price * qty,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    line_total: product.unit_price * qty,
  };
}

function billFor(invoice, items, total) {
  return {
    invoice_number: invoice,
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    customer_state: 'Madhya Pradesh',
    subtotal: total,
    cgst_total: 0,
    sgst_total: 0,
    igst_total: 0,
    grand_total: total,
    items,
  };
}

const newProduct = (name, stock, price) => ({
  name,
  category: 'Other',
  stock_qty: stock,
  unit_price: price,
  gst_rate: 0,
  hsn_code: null,
  brand: null,
  model_number: null,
  low_stock_threshold: null,
  price_includes_gst: false,
  purchase_price: null,
});

async function run({ check, section }) {
  const db = await initDatabase({ directory: tempDir('billedit') });

  const cable = await products.createProduct(newProduct('Cable', 100, 10), db);
  const bulb = await products.createProduct(newProduct('Bulb', 50, 20), db);

  section('stock moves by the DIFFERENCE, not by replacing it');
  // Not "add the old quantities back, then take the new ones off": that passes
  // through a value which is briefly wrong, and a failure between the halves
  // would leave stock inflated by a whole bill.
  const bill = await bills.createBill(
    billFor('E-1', [line(cable, 10), line(bulb, 5)], 200), db);
  check('creating the bill takes stock off', (await products.getProductById(cable.id, db)).stock_qty, 90);
  check('for every line', (await products.getProductById(bulb.id, db)).stock_qty, 45);

  await bills.editBill(bill.id, {
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    customer_state: 'Madhya Pradesh',
    subtotal: 260,
    cgst_total: 0,
    sgst_total: 0,
    igst_total: 0,
    grand_total: 260,
    items: [line(cable, 12), line(bulb, 7)],
  }, db);

  check('billing two more takes two more off',
    (await products.getProductById(cable.id, db)).stock_qty, 88);
  check('and the same for the other line',
    (await products.getProductById(bulb.id, db)).stock_qty, 43);

  await bills.editBill(bill.id, {
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    customer_state: 'Madhya Pradesh',
    subtotal: 100,
    cgst_total: 0,
    sgst_total: 0,
    igst_total: 0,
    grand_total: 100,
    items: [line(cable, 10)],
  }, db);
  check('billing fewer puts some back', (await products.getProductById(cable.id, db)).stock_qty, 90);
  check('and a removed line returns all of it',
    (await products.getProductById(bulb.id, db)).stock_qty, 50);

  section('the number and the date are kept; only the contents change');
  const edited = await bills.getBillById(bill.id, db);
  check('the invoice number is the customer’s reference and does not move',
    edited.invoice_number, 'E-1');
  check('the date decides the GST return period and does not move either',
    edited.date, bill.date);
  check('an edit is recorded as one', edited.edited_at !== null, true);

  section('an edit clears the stored PDF');
  // The file is named by invoice number and holds the PRE-EDIT figures, so
  // leaving it would reshare a document that disagrees with the shop's record
  // under the same number.
  check('pdf_path is cleared', edited.pdf_path, null);

  section('the version replaced is kept as a snapshot');
  const history = await bills.listBillEdits(bill.id, db);
  check('every edit leaves one', history.length, 2);
  // A snapshot rather than normalised rows: it is never queried, only read
  // back whole if a dispute comes up, and a second copy of bill_items would
  // have to be migrated forward for ever alongside the real one.
  const mostRecent = history[0].snapshot;
  check('carrying the totals as they stood', mostRecent.grand_total, 260);
  check('and the lines as they stood', mostRecent.items.length, 2);

  section('deletion is soft, so the invoice number stays consumed');
  await bills.deleteBill(bill.id, { restoreStock: false }, db);
  const live = await bills.listBills({}, db);
  check('it is gone from the shop’s sales',
    live.some((row) => row.id === bill.id), false);
  check('and out of the summary that describes them',
    (await bills.summariseBills({}, db)).billCount, live.length);
  // Fetching one bill by id still returns it: that is "show me this bill",
  // not "the shop's sales", and the row has to stay readable.
  check('but the row itself is still readable',
    (await bills.getBillById(bill.id, db)).deleted_at !== null, true);
  // Reissuing it would hand two customers the same reference — worse than the
  // gap a deletion leaves.
  check('but the number cannot be reused',
    await bills.invoiceNumberExists('E-1', db), true);

  section('and whether stock returns is asked, never assumed');
  const second = await bills.createBill(billFor('E-2', [line(cable, 10)], 100), db);
  check('stock went out with it', (await products.getProductById(cable.id, db)).stock_qty, 80);
  await bills.deleteBill(second.id, { restoreStock: true }, db);
  check('and comes back when asked for', (await products.getProductById(cable.id, db)).stock_qty, 90);

  const third = await bills.createBill(billFor('E-3', [line(cable, 5)], 50), db);
  await bills.deleteBill(third.id, { restoreStock: false }, db);
  check('and stays out when not', (await products.getProductById(cable.id, db)).stock_qty, 85);

  section('deleting twice cannot restore stock twice');
  await bills.deleteBill(second.id, { restoreStock: true }, db);
  check('the second delete is a no-op',
    (await products.getProductById(cable.id, db)).stock_qty, 85);
}

module.exports = { run };
