'use strict';

/**
 * A bill and a quotation can be raised with no customer name and no phone
 * (T9.5).
 *
 * The state still blocks, because it decides the tax heads and a wrong
 * CGST/SGST split is wrong on a tax document.
 */

const { tempDir, readSource, readSourceWithoutComments } = require('../harness/check');
const { initDatabase } = require('@/db/init');
const bills = require('@/db/bills');
const quotations = require('@/db/quotations');
const {
  validateCustomer,
  customerDisplayName,
  hasCustomerName,
  NO_NAME_LABEL,
} = require('@/lib/customer');
const { renderBillHtml } = require('@/lib/pdf');
const { renderQuotationHtml } = require('@/lib/quotationPdf');

const ITEM = {
  product_id: null,
  product_name_snapshot: 'Cable',
  hsn_code_snapshot: null,
  qty: 1,
  unit: null,
  unit_price_snapshot: 100,
  gst_rate_snapshot: 0,
  taxable_value: 100,
  cgst_amount: 0,
  sgst_amount: 0,
  igst_amount: 0,
  line_total: 100,
};

const BUSINESS = {
  name: 'Mahale Phones And Electronics', gstin: '23ALYPM5121B1ZA',
  addressLine1: 'Shop No. 7', addressLine2: 'Shanwara', city: 'Burhanpur',
  state: 'Madhya Pradesh', pincode: '450331', phone: '9826351449',
  email: 'x@y.com', bankName: 'PLACEHOLDER', bankAccountNumber: 'PLACEHOLDER',
  bankIfsc: 'PLACEHOLDER', logoPath: null,
};

function billRow(extra) {
  return {
    id: 1, invoice_number: 'MPE/2026-27/0151', date: '2026-09-01T00:00:00.000Z',
    customer_name: '', customer_phone: '', customer_address: null,
    customer_gstin: null, customer_state: 'Madhya Pradesh',
    subtotal: 100, cgst_total: 0, sgst_total: 0, igst_total: 0,
    round_off: 0, grand_total: 100, pdf_path: null, payment_type: null, paid: null,
    deleted_at: null, edited_at: null, created_at: '2026-09-01',
    items: [{ ...ITEM, id: 1, bill_id: 1 }],
    ...extra,
  };
}

async function run({ check, section }) {
  const db = await initDatabase({ directory: tempDir('optional') });

  section('validation no longer demands either');
  const blank = { name: '', phone: '', address: '', gstin: '', state: 'Madhya Pradesh' };
  const result = validateCustomer(blank, 'Madhya Pradesh');
  check('a bill with neither can be generated', result.canGenerate, true);
  check('and no error names the customer', result.errors.map((e) => e.field), []);

  section('but the state still blocks, because it decides the tax heads');
  const noState = validateCustomer({ ...blank, state: '' }, 'Madhya Pradesh');
  check('no state, no bill', noState.canGenerate, false);
  check('and it says which field', noState.errors.map((e) => e.field), ['state']);

  section('a partly typed number is still a mistake');
  // "Nothing" is a decision; six digits is a slip, and letting it through would
  // put an unreachable number on the invoice with nothing to say it is wrong.
  const short = validateCustomer({ ...blank, phone: '98263' }, 'Madhya Pradesh');
  check('too few digits is refused', short.canGenerate, false);
  check('on the phone field', short.errors.map((e) => e.field), ['phone']);

  const landline = validateCustomer({ ...blank, phone: '0733245112' }, 'Madhya Pradesh');
  check('a full non-mobile number is allowed', landline.canGenerate, true);
  check('with a warning rather than an error',
    landline.warnings.some((w) => w.field === 'phone'), true);
  // An empty field must not warn, or every nameless bill nags.
  check('and an empty one warns about nothing',
    result.warnings.some((w) => w.field === 'phone'), false);

  section('the repository writes them');
  const bill = await bills.createBill({
    invoice_number: 'N-1',
    customer_name: '',
    customer_phone: '',
    customer_state: 'Madhya Pradesh',
    subtotal: 100, cgst_total: 0, sgst_total: 0, igst_total: 0, grand_total: 100,
    items: [ITEM],
  }, db);
  check('a nameless bill saves', bill.invoice_number, 'N-1');
  check('storing an empty string, not a fake name', bill.customer_name, '');

  const quotation = await quotations.createQuotation({
    customer_name: '',
    customer_phone: '',
    subtotal: 100, gst_total: 0, grand_total: 100,
    items: [{
      product_id: null, product_name_snapshot: 'Cable', hsn_code_snapshot: null,
      qty: 1, unit: null, unit_price_snapshot: 100, gst_rate_snapshot: 0,
      price_includes_gst: 0, taxable_value: 100, gst_amount: 0, line_total: 100,
    }],
  }, db);
  check('and so does a nameless quotation', quotation.reference_number, 'Q-0001');

  section('on screen a missing name has a stand-in');
  // A row needs something in the name slot or it reads as broken.
  check('which is honest about being one', customerDisplayName(''), NO_NAME_LABEL);
  check('and about whitespace too', customerDisplayName('   '), NO_NAME_LABEL);
  check('a real name passes through trimmed', customerDisplayName(' Ramesh '), 'Ramesh');
  check('hasCustomerName says which it is', hasCustomerName(''), false);
  // "No name" rather than "Walk-in" or "Counter sale": those assert something
  // nobody recorded, the same reason a missing paid status reads "Not recorded".
  check('and it invents nothing about the sale',
    /walk|counter|cash customer/i.test(NO_NAME_LABEL), false);

  section('and one definition, used everywhere');
  // Five copies of a fallback string drift the way the category chips did.
  for (const file of [
    'app/(tabs)/dashboard.tsx',
    'app/(tabs)/history.tsx',
    'app/(tabs)/quotations.tsx',
    'app/bill/[id].tsx',
    'app/quotation/[id].tsx',
  ]) {
    check(`${file} uses the shared helper`,
      readSource(file).includes('customerDisplayName('), true);
    // Comments stripped: the note explaining the fallback quotes it, and a
    // whole-file search matched that prose rather than any code.
    check(`${file} spells no fallback of its own`,
      /'No name'|"No name"|Walk-?in/.test(readSourceWithoutComments(file)), false);
  }

  section('but the PRINTED documents omit the line instead');
  // Printing "No name" where a customer's name goes is worse than printing
  // nothing: it reads as a fault on a legal document.
  const bare = renderBillHtml(billRow(), BUSINESS, {});
  check('no stand-in reaches the invoice', bare.includes(NO_NAME_LABEL), false);
  // A "Phone:" label with nothing after it is the same kind of fault.
  check('and no dangling phone label', /Phone:\s*<\/div>/.test(bare), false);
  check('the heading still has the place of supply under it',
    bare.includes('Billed to') && bare.includes('State:'), true);

  const named = renderBillHtml(
    billRow({ customer_name: 'Ramesh', customer_phone: '9826351449' }), BUSINESS, {});
  check('a real name still prints', named.includes('Ramesh'), true);
  check('and a real phone still prints', named.includes('Phone: 9826351449'), true);

  section('the quotation drops the whole block when it is empty');
  // Unlike the invoice's, this one has no place of supply beneath it, so the
  // heading would sit alone over nothing.
  const quotationRow = {
    id: 1, reference_number: 'Q-0001', date: '2026-09-01T00:00:00.000Z',
    customer_name: '', customer_phone: '', customer_address: null,
    subtotal: 100, gst_total: 0, grand_total: 100, converted_bill_id: null,
    converted_at: null, pdf_path: null, edited_at: null, created_at: '2026-09-01',
    items: [{
      id: 1, quotation_id: 1, product_id: null, product_name_snapshot: 'Cable',
      hsn_code_snapshot: null, qty: 1, unit: null, unit_price_snapshot: 100,
      gst_rate_snapshot: 0, price_includes_gst: 0, taxable_value: 100,
      gst_amount: 0, line_total: 100,
    }],
  };
  const bareQuotation = renderQuotationHtml(quotationRow, BUSINESS, {});
  check('the heading goes with the details', bareQuotation.includes('Quotation for'), false);
  check('and nothing is left dangling', /Phone:\s*<\/div>/.test(bareQuotation), false);

  const withName = renderQuotationHtml(
    { ...quotationRow, customer_name: 'Ramesh' }, BUSINESS, {});
  check('a name brings the heading back', withName.includes('Quotation for'), true);
  check('and prints', withName.includes('Ramesh'), true);
}

module.exports = { run };
