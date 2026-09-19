'use strict';

/**
 * The payments block on the invoice (T9.3).
 *
 * The template is a pure function, so what actually reaches the customer's copy
 * is checkable here. What is NOT: how the block paginates when a bill already
 * runs past one page, and whether it reads as a statement attached to the
 * invoice rather than part of it. Both need the Android print sheet.
 */

const { renderBillHtml } = require('@/lib/pdf');

const BUSINESS = {
  name: 'Mahale Phones And Electronics',
  gstin: '23ALYPM5121B1ZA',
  addressLine1: 'Shop No. 7',
  addressLine2: 'Shanwara',
  city: 'Burhanpur',
  state: 'Madhya Pradesh',
  pincode: '450331',
  phone: '9826351449',
  email: 'x@y.com',
  bankName: 'PLACEHOLDER_BANK',
  bankAccountNumber: 'PLACEHOLDER',
  bankIfsc: 'PLACEHOLDER',
  logoPath: null,
};

const BILL = {
  id: 1,
  invoice_number: 'MPE/2026-27/0151',
  date: '2026-09-01T00:00:00.000Z',
  customer_name: 'Ramesh Kumar',
  customer_phone: '9826351449',
  customer_address: null,
  customer_gstin: null,
  customer_state: 'Madhya Pradesh',
  subtotal: 1000,
  cgst_total: 90,
  sgst_total: 90,
  igst_total: 0,
  round_off: 0,
  grand_total: 1180,
  pdf_path: null,
  payment_type: 'Credit',
  paid: 0,
  deleted_at: null,
  edited_at: null,
  created_at: '2026-09-01',
  items: [
    {
      id: 1,
      bill_id: 1,
      product_id: 1,
      product_name_snapshot: 'CCTV Camera',
      hsn_code_snapshot: '8525',
      qty: 1,
      unit: null,
      unit_price_snapshot: 1000,
      gst_rate_snapshot: 18,
      taxable_value: 1000,
      cgst_amount: 90,
      sgst_amount: 90,
      igst_amount: 0,
      line_total: 1180,
    },
  ],
};

const AT = new Date('2026-09-20T00:00:00.000Z');
const entry = (amount, paidOn) => ({
  id: 1,
  bill_id: 1,
  amount,
  paid_on: paidOn,
  note: null,
  created_at: 'x',
  edited_at: null,
});

async function run({ check, section }) {
  const render = (payments) => renderBillHtml(BILL, BUSINESS, { payments, renderedAt: AT });

  section('an unpaid bill prints exactly as it did before');
  // The whole promise of the "only if a payment exists" rule: the document must
  // not start asserting something about money nobody entered.
  const bare = renderBillHtml(BILL, BUSINESS, {});
  const empty = render([]);
  check('no payments block with no ledger', /Payments received/.test(bare), false);
  check('and none with an empty one', /Payments received/.test(empty), false);
  check('an empty ledger renders byte for byte the same as none', empty, bare);
  check('nothing about payment status leaks in either',
    /Paid in full|Part paid|outstanding/.test(bare), false);

  section('one payment prints the date and the amount');
  const one = render([entry(1180, '2026-09-15')]);
  check('the block appears', /Payments received/.test(one), true);
  check('with the date, in the format the rest of the document uses',
    one.includes('15/09/2026'), true);
  check('and the amount', one.includes('1,180.00'), true);
  check('and says where the bill stands', /Paid in full/.test(one), true);

  section('instalments print with a total and the balance');
  const parts = render([entry(500, '2026-09-05'), { ...entry(300, '2026-09-12'), id: 2 }]);
  check('both rows are there', (parts.match(/<td class="r">\d/g) || []).length >= 2, true);
  check('the total received is shown', parts.includes('800.00'), true);
  check('and what is still owed', /Part paid/.test(parts) && parts.includes('380.00'), true);

  section('an entry with no date prints a dash, never a guess');
  // Migration 010 backfilled bills already marked paid. The amount was
  // recorded; the date never was, and printing a guess would put a date on the
  // customer's copy that nobody entered.
  const undated = render([entry(1180, null)]);
  check('a dash stands in for the missing date', undated.includes('&mdash;'), true);
  // Tight on the real format. An earlier version of this check looked for a
  // format the document does not use, so it would have passed on any invented
  // date at all.
  const undatedBlock = undated.split('Payments received')[1].split('As at')[0];
  check('and no date is invented in its row', /\d{2}\/\d{2}\/\d{4}/.test(undatedBlock), false);
  check('the amount still prints', undated.includes('1,180.00'), true);

  section('the block says when it was drawn');
  // Without this, two copies in a customer's hand contradict each other with
  // nothing to explain why. The invoice above is fixed; this part is not.
  check('an as-at date is printed', /As at /.test(one), true);
  check('it is the date passed in', one.includes('20/09/2026'), true);
  check('and it says later payments are not shown', /not shown/.test(one), true);

  section('overpayment is stated rather than hidden');
  const over = render([entry(1200, '2026-09-15')]);
  check('it still reads as paid in full', /Paid in full/.test(over), true);
  check('and names the excess', over.includes('20.00'), true);

  section('the invoice above the block is untouched');
  // lib/pdf.ts exists to keep the customer's copy and the shop's record the
  // same document. Adding a mutable block must not move anything fixed.
  const bodyOf = (html) => html.split('<div class="sign">')[0];
  check('the invoice body is identical with and without payments', bodyOf(one), bodyOf(bare));
  check('the block sits after the signature',
    one.indexOf('Payments received') > one.indexOf('Authorised Signatory'), true);

  section('free text is still escaped');
  const nasty = render([{ ...entry(100, '2026-09-15'), note: '<script>x</script>' }]);
  check('no raw script tag reaches the document', /<script>/.test(nasty), false);
}

module.exports = { run };
