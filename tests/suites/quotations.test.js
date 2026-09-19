'use strict';

/**
 * Quotations: numbering, conversion, editing and deleting (T5.7, T5.9).
 *
 * NOTE: a rebuild, not a restoration. The original suites were lost with the
 * scratchpad harness; these were written afresh from the decisions in
 * CLAUDE.md. Same rules, different assertions.
 */

const { tempDir, readSource } = require('../harness/check');
const { initDatabase } = require('@/db/init');
const quotations = require('@/db/quotations');
const bills = require('@/db/bills');

function quotationFor(total, extra) {
  return {
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    subtotal: total,
    gst_total: 0,
    grand_total: total,
    items: [
      {
        product_id: null,
        product_name_snapshot: 'Cable',
        hsn_code_snapshot: null,
        qty: 1,
        unit: null,
        unit_price_snapshot: total,
        gst_rate_snapshot: 0,
        price_includes_gst: 0,
        taxable_value: total,
        gst_amount: 0,
        line_total: total,
      },
    ],
    ...extra,
  };
}

async function run({ check, section }) {
  const db = await initDatabase({ directory: tempDir('quotations') });

  section('references are one unbroken series');
  // The invoice series restarts each 1 April because GST returns are filed by
  // financial year. A quotation appears on no return, so it has nothing to
  // restart for — and one series means a reference can never be mistaken for
  // an invoice number.
  const first = await quotations.createQuotation(quotationFor(100), db);
  const second = await quotations.createQuotation(quotationFor(200), db);
  check('the first is Q-0001', first.reference_number, 'Q-0001');
  check('and they run on', second.reference_number, 'Q-0002');

  section('making one never touches the invoice counter');
  // Ten quotations and no sales has to leave the invoice series untouched.
  check('no bill exists', (await bills.listBills({}, db)).length, 0);
  check('and no invoice number has been consumed',
    await bills.invoiceNumberExists('MPE/2026-27/0151', db), false);

  section('only a TRAILING reference is reclaimed');
  // After a delete the counter is set to the highest reference still in use, so
  // deleting the newest frees its number while deleting an older one leaves
  // that gap. Reusing an arbitrary gap was rejected: numbers would be issued
  // out of order, so a reference would stop implying age.
  await quotations.deleteQuotation(second.id, db);
  const reissued = await quotations.createQuotation(quotationFor(300), db);
  check('the newest number comes back', reissued.reference_number, 'Q-0002');

  const third = await quotations.createQuotation(quotationFor(400), db);
  check('and the series carries on from there', third.reference_number, 'Q-0003');

  await quotations.deleteQuotation(reissued.id, db);
  const afterGap = await quotations.createQuotation(quotationFor(500), db);
  check('deleting an older one leaves its gap alone', afterGap.reference_number, 'Q-0004');

  section('deleting a quotation is a REAL delete');
  // The opposite of a bill's. An invoice number must stay consumed for ever, so
  // a bill's row survives; a quotation reference is meant to be reusable and
  // reference_number is UNIQUE, so the row has to go for the number to return.
  check('the row is gone', await quotations.getQuotationById(reissued.id, db), null);

  section('converting marks it, once');
  const toConvert = await quotations.createQuotation(quotationFor(600), db);
  const converted = await quotations.convertQuotationToBill(toConvert.id, {
    invoice_number: 'MPE/2026-27/0151',
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    customer_state: 'Madhya Pradesh',
    subtotal: 600,
    cgst_total: 0,
    sgst_total: 0,
    igst_total: 0,
    grand_total: 600,
    items: [
      {
        product_id: null,
        product_name_snapshot: 'Cable',
        hsn_code_snapshot: null,
        qty: 1,
        unit: null,
        unit_price_snapshot: 600,
        gst_rate_snapshot: 0,
        taxable_value: 600,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        line_total: 600,
      },
    ],
  }, db);

  const marked = await quotations.getQuotationById(toConvert.id, db);
  check('the quotation records which bill it became',
    marked.converted_bill_id, converted.billId);
  // converted_bill_id is the ONLY record of this. A separate boolean would be a
  // second copy of the same fact, free to disagree with the link.
  check('and there is no second flag saying the same thing',
    'converted' in marked, false);

  section('and cannot convert twice');
  let threw = null;
  try {
    await quotations.convertQuotationToBill(toConvert.id, {
      invoice_number: 'MPE/2026-27/0152',
      customer_name: 'Ramesh',
      customer_phone: '9826351449',
      customer_state: 'Madhya Pradesh',
      subtotal: 600, cgst_total: 0, sgst_total: 0, igst_total: 0, grand_total: 600,
      items: [{
        product_id: null, product_name_snapshot: 'Cable', hsn_code_snapshot: null,
        qty: 1, unit: null, unit_price_snapshot: 600, gst_rate_snapshot: 0,
        taxable_value: 600, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, line_total: 600,
      }],
    }, db);
  } catch (error) {
    threw = error.constructor.name;
  }
  check('a second conversion is refused', threw, 'AlreadyConvertedError');
  check('and no second bill was written', (await bills.listBills({}, db)).length, 1);

  // The behavioural race CANNOT be driven here: node:sqlite is synchronous on
  // one connection, so two conversions serialise and this would pass with the
  // guard removed. The SQL itself is what carries the protection.
  const source = readSource('db/quotations.ts');
  // Tied to the UPDATE specifically. A bare search for the clause matched the
  // openOnly list filter as well, so removing it from the UPDATE left this
  // passing -- found by a negative control, which is the only way that kind of
  // looseness shows up.
  check('the guard is on the UPDATE that marks a conversion',
    /UPDATE quotations[\s\S]{0,200}?WHERE id = \? AND converted_bill_id IS NULL/.test(source),
    true);
  // And the changes check is what turns a no-op UPDATE into a refusal.
  check('with a changes check behind it',
    /result\.changes === 0/.test(source), true);

  section('a converted quotation stays editable, and the bill is untouched');
  await quotations.editQuotation(toConvert.id, quotationFor(650), db);
  const edited = await quotations.getQuotationById(toConvert.id, db);
  check('the offer can be corrected', edited.grand_total, 650);
  // Correcting a typo on the offer must not reach into a tax record.
  check('the bill it became is unchanged',
    (await bills.getBillById(converted.billId, db)).grand_total, 600);
  // A negative control on the real code clears this and the quotation becomes
  // convertible a second time.
  check('and it is still marked converted', edited.converted_bill_id, converted.billId);
  check('an edit is recorded as one', edited.edited_at !== null, true);
}

module.exports = { run };
