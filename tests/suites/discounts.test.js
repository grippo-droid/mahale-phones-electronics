'use strict';

/**
 * Per-item discounts (T9.6): the arithmetic, the storage, and the round trips.
 *
 * ---------------------------------------------------------------------------
 * A note on the numbers used here.
 *
 * ₹1000 with 10% off is a useless test. It comes to 900 under every ordering,
 * every rounding rule and both of the ways a discount could be apportioned, so
 * it passes whatever the code does. The figures below are chosen because they
 * DIVERGE: ₹333.33 × 3 with 10% off lands on 1,061.99 when the discount is
 * taken off the line and 1,062.00 when it is taken off each unit, and an
 * inclusive-price line lands a paisa away from its own round number. A test
 * that cannot tell two implementations apart is not testing either of them.
 * ---------------------------------------------------------------------------
 */

const { tempDir, readSource, readSourceWithoutComments } = require('../harness/check');
const {
  calculateLine,
  calculateBill,
  discountAmountFor,
  isDiscountClamped,
  storedDiscount,
  round2,
} = require('@/lib/gst');
const { initDatabase } = require('@/db/init');
const bills = require('@/db/bills');
const quotations = require('@/db/quotations');
const products = require('@/db/products');
const { buildNewBill } = require('@/lib/billDraft');
const { buildNewQuotation, quotationToCartLines } = require('@/lib/quotationDraft');
const { billToCartLines } = require('@/lib/billDraft');
const { renderBillHtml } = require('@/lib/pdf');

const INTRA = 'intra-state';

const line = (unitPrice, qty, gstRate, discount, priceIncludesGst = false) =>
  calculateLine({ unitPrice, qty, gstRate, priceIncludesGst, discount }, INTRA);

const cartLine = (over = {}) => ({
  productId: 1,
  name: 'Cable',
  hsnCode: '8544',
  unitPrice: 1000,
  gstRate: 18,
  priceIncludesGst: false,
  qty: 1,
  unit: null,
  discount: null,
  ...over,
});

const CUSTOMER = {
  name: 'Ramesh', phone: '9826351449', address: '', gstin: '', state: 'Madhya Pradesh',
};

async function run({ check, section }) {
  section('discounted, then taxed');
  // The order the owner confirmed, and the only one that makes the printed
  // rate honest: the invoice shows taxable / qty, so the customer sees the
  // discounted price as the rate they were charged.
  const plain = line(1000, 1, 18, null);
  const tenOff = line(1000, 1, 18, { type: 'percent', value: 10 });
  check('undiscounted is 1180', plain.lineTotal, 1180);
  check('taxable falls to 900', tenOff.taxableValue, 900);
  check('CGST and SGST follow it down', [tenOff.cgstAmount, tenOff.sgstAmount], [81, 81]);
  check('and the line comes to 1062', tenOff.lineTotal, 1062);
  // Taxed-then-discounted would be 1180 x 0.9 = 1062 here TOO, so this pair
  // alone proves nothing about the ordering. The inclusive case below does.
  check('the discount taken is recorded', tenOff.discountAmount, 100);
  check('and so is what it came off', tenOff.grossBeforeDiscount, 1000);

  section('the ordering, where the two routes actually differ');
  // An MRP of 1000 including 18%, 10% off. Discounted-then-taxed: 900 gross,
  // taxable 762.71, tax 137.28, line 899.99. Taxed-then-discounted would keep
  // the taxable at 847.46 and knock the discount off the total instead, giving
  // a different taxable value on the invoice and a different tax figure.
  const incl = line(1000, 1, 18, { type: 'percent', value: 10 }, true);
  check('the taxable value is derived from the DISCOUNTED gross',
    incl.taxableValue, 762.71);
  check('so the tax is charged on the discounted amount',
    [incl.cgstAmount, incl.sgstAmount], [68.64, 68.64]);
  check('and the line lands a paisa under 900', incl.lineTotal, 899.99);
  // Undiscounted, the same item taxes 847.46. If the discount were applied
  // after tax, that figure would survive onto the invoice.
  check('which is NOT the undiscounted taxable value',
    incl.taxableValue === line(1000, 1, 18, null, true).taxableValue, false);

  section('a discount is taken off the LINE, never off each unit');
  // 333.33 x 3 = 999.99. Ten per cent of that is 100.00, leaving 899.99.
  // Per unit it would be 333.33 -> 300.00, x3 = 900.00. One paisa apart, and
  // the per-unit route is wrong for the reason calculateLine already gives:
  // rounding per unit multiplies the error by the quantity.
  const perLine = line(333.33, 3, 18, { type: 'percent', value: 10 });
  check('the line keeps its paisa', perLine.taxableValue, 899.99);
  check('and totals 1061.99', perLine.lineTotal, 1061.99);
  check('not 1062.00', perLine.lineTotal === 1062, false);

  // A flat amount is per line too: "100 off" on three of something is 100,
  // not 300.
  const flat = line(333.33, 3, 18, { type: 'amount', value: 100 });
  check('a flat 100 takes exactly 100 off the line', flat.discountAmount, 100);
  check('reaching the same place as the percentage', flat.lineTotal, 1061.99);
  check('and NOT 100 off each unit',
    flat.taxableValue === round2(999.99 - 300), false);

  section('what the discount comes to');
  check('a percentage of the line', discountAmountFor(999.99, { type: 'percent', value: 10 }), 100);
  check('a flat amount is itself', discountAmountFor(999.99, { type: 'amount', value: 250 }), 250);
  check('no discount takes nothing', discountAmountFor(1000, null), 0);
  check('zero takes nothing', discountAmountFor(1000, { type: 'percent', value: 0 }), 0);
  check('a negative takes nothing', discountAmountFor(1000, { type: 'amount', value: -50 }), 0);

  section('a discount can never exceed the line');
  // A bigger discount would make the taxable value negative, and negative GST
  // is not a thing that can appear on a tax invoice. The item becomes free and
  // the screen says so -- warn, never block, as with overselling.
  check('a flat amount over the line is clamped',
    discountAmountFor(1000, { type: 'amount', value: 2000 }), 1000);
  check('over 100% is clamped too',
    discountAmountFor(1000, { type: 'percent', value: 150 }), 1000);
  const free = line(1000, 1, 18, { type: 'amount', value: 2000 });
  check('the line goes to zero, not below', free.taxableValue, 0);
  check('with no tax on it', free.lineTotal, 0);
  check('and the clamp is reportable', isDiscountClamped(1000, { type: 'amount', value: 2000 }), true);
  check('an ordinary discount is not', isDiscountClamped(1000, { type: 'amount', value: 200 }), false);

  section('a line without a discount is untouched');
  // Every bill already raised has to keep its arithmetic exactly.
  for (const [price, qty, rate, incl2] of [
    [333.33, 3, 18, false], [1000, 1, 18, true], [90, 10, 12, true], [1234.56, 7, 28, false],
  ]) {
    const before = calculateLine({ unitPrice: price, qty, gstRate: rate, priceIncludesGst: incl2 }, INTRA);
    const after = calculateLine(
      { unitPrice: price, qty, gstRate: rate, priceIncludesGst: incl2, discount: null }, INTRA);
    check(`${price} x ${qty} @ ${rate}% is unchanged`,
      [before.taxableValue, before.lineTotal], [after.taxableValue, after.lineTotal]);
    check(`and reports no discount`, after.discountAmount, 0);
  }

  section('the bill total adds up from the discounted lines');
  const mixed = calculateBill([
    { unitPrice: 333.33, qty: 3, gstRate: 18, priceIncludesGst: false, discount: { type: 'percent', value: 10 } },
    { unitPrice: 1000, qty: 1, gstRate: 18, priceIncludesGst: false, discount: null },
  ], INTRA, { roundToNearestRupee: true });
  check('the subtotal is the sum of discounted taxables', mixed.totals.subtotal, round2(899.99 + 1000));
  check('and the grand total rounds from those', mixed.totals.grandTotal, 2242);
  check('with the difference shown as round off', mixed.totals.roundOff, round2(2242 - 2241.99));

  section('reading a stored discount back');
  check('a percentage', storedDiscount('percent', 10), { type: 'percent', value: 10 });
  check('an amount', storedDiscount('amount', 250), { type: 'amount', value: 250 });
  check('nothing stored is no discount', storedDiscount(null, null), null);
  // A hand-edited database or a backup from a future build must not put an
  // unknown rule on a bill.
  check('an unknown type is refused', storedDiscount('half-price', 50), null);
  check('a type with no value is refused', storedDiscount('percent', null), null);

  section('it survives being written and read back');
  const db = await initDatabase({ directory: tempDir('discounts') });
  const cable = await products.createProduct({
    name: 'Cable', category: 'Other', stock_qty: 50, unit_price: 333.33, gst_rate: 18,
    hsn_code: '8544', brand: null, model_number: null, low_stock_threshold: null,
    price_includes_gst: false, purchase_price: null,
  }, db);

  const draft = buildNewBill({
    lines: [cartLine({ productId: cable.id, unitPrice: 333.33, qty: 3, discount: { type: 'percent', value: 10 } })],
    customer: CUSTOMER, supplyType: INTRA, paymentType: 'Cash', paid: true,
  });
  const saved = await bills.createBill({ ...draft, invoice_number: 'D-1' }, db);
  const item = saved.items[0];

  check('the agreement is stored', [item.discount_type, item.discount_value], ['percent', 10]);
  check('and what it took off', item.discount_amount, 100);
  check('the snapshot is the price BEFORE the discount', item.unit_price_snapshot, 333.33);
  check('the taxable value is after it', item.taxable_value, 899.99);
  check('the basis is recorded now', item.price_includes_gst, 0);
  check('and the bill total reflects it', saved.grand_total, 1062);

  section('editing a discounted bill does not double it, or lose it');
  // This is the trap the migration exists for. billToCartLines used to rebuild
  // the price as taxable / qty, which is the POST-discount figure -- so a
  // discounted line would either have the discount taken off twice or baked
  // into the price with the record of it lost.
  const reopened = billToCartLines(saved);
  check('the cart gets the pre-discount price back', reopened[0].unitPrice, 333.33);
  check('with its basis', reopened[0].priceIncludesGst, false);
  check('and its discount intact', reopened[0].discount, { type: 'percent', value: 10 });

  const rebuilt = buildNewBill({
    lines: reopened, customer: CUSTOMER, supplyType: INTRA, paymentType: 'Cash', paid: true,
  });
  check('so saving it again reproduces the same figures',
    [rebuilt.items[0].taxable_value, rebuilt.grand_total], [899.99, 1062]);
  check('and the same discount', rebuilt.items[0].discount_amount, 100);

  await bills.editBill(saved.id, { ...rebuilt, items: rebuilt.items }, db);
  const afterEdit = await bills.getBillById(saved.id, db);
  check('an edit keeps the discount', afterEdit.items[0].discount_amount, 100);
  check('and the total', afterEdit.grand_total, 1062);

  section('an older line, with no basis recorded, is rebuilt the old way');
  // Those lines carry no discount, so taxable / qty is still exact for them.
  const legacy = billToCartLines({
    ...saved,
    items: [{ ...item, price_includes_gst: null, discount_type: null, discount_value: null, discount_amount: 0 }],
  });
  check('as a pre-tax price', legacy[0].priceIncludesGst, false);
  check('and it carries no discount', legacy[0].discount, null);
  // The quotient is deliberately NOT rounded here -- it feeds straight back
  // into calculateLine, which rounds the line once. Rounding it per unit first
  // is the very error that route exists to avoid. What matters is that the
  // round trip reproduces the stored figures, so that is what is checked.
  const legacyRebuilt = buildNewBill({
    lines: legacy, customer: CUSTOMER, supplyType: INTRA, paymentType: 'Cash', paid: true,
  });
  check('and rebuilding it reproduces the stored taxable value',
    legacyRebuilt.items[0].taxable_value, 899.99);
  check('and the same bill total', legacyRebuilt.grand_total, 1062);

  section('a quotation carries its discount into the bill');
  // A discount negotiated on the offer must survive conversion, or the customer
  // who was quoted a discounted price is charged the full one.
  const qDraft = buildNewQuotation({
    lines: [{
      productId: cable.id, name: 'Cable', hsnCode: '8544', unitPrice: 333.33,
      gstRate: 18, priceIncludesGst: false, qty: 3, unit: null,
      discount: { type: 'amount', value: 100 },
    }],
    customer: { name: 'Ramesh', phone: '9826351449', address: '' },
  });
  const quotation = await quotations.createQuotation(qDraft, db);
  check('the quotation stores it', quotation.items[0].discount_amount, 100);

  const backToCart = quotationToCartLines(quotation);
  check('converting carries the agreement', backToCart[0].discount, { type: 'amount', value: 100 });
  check('and the pre-discount price', backToCart[0].unitPrice, 333.33);

  const fromQuotation = buildNewBill({
    lines: backToCart, customer: CUSTOMER, supplyType: INTRA, paymentType: 'Cash', paid: true,
  });
  check('so the bill charges the quoted figure', fromQuotation.grand_total, 1062);
  check('and not the undiscounted one', fromQuotation.grand_total === 1180, false);

  section('nothing about the discount reaches the invoice');
  // The owner sees it in the app; the customer sees a price. The PDF derives
  // its rate from taxable / qty, so the discounted rate prints as if it were
  // the ordinary one -- there is no label to remove, and this check is here so
  // one cannot be added by accident.
  const html = renderBillHtml(afterEdit, {
    name: 'Mahale Phones And Electronics', gstin: '23ALYPM5121B1ZA',
    addressLine1: 'Shop No. 7', addressLine2: 'Shanwara', city: 'Burhanpur',
    state: 'Madhya Pradesh', pincode: '450331', phone: '9826351449', email: 'x@y.com',
    bankName: 'PLACEHOLDER', bankAccountNumber: 'PLACEHOLDER', bankIfsc: 'PLACEHOLDER',
    logoPath: null,
  }, {});
  check('no discount label', /[Dd]iscount/.test(html), false);
  check('the rate printed is the discounted one', html.includes('300.00'), true);
  // 333.33 is what the item cost before the discount. It must not appear.
  check('the pre-discount price is nowhere on it', html.includes('333.33'), false);
  check('and the total is the discounted total', html.includes('1,062.00'), true);

  section('visible in the app, absent from both documents');
  // The split the owner asked for: they can see what was given on which line,
  // at any time later; the customer sees a price.
  for (const screen of ['app/bill/[id].tsx', 'app/quotation/[id].tsx']) {
    check(`${screen} shows what came off`,
      readSource(screen).includes('item.discount_amount > 0'), true);
  }
  for (const doc of ['lib/pdf.ts', 'lib/quotationPdf.ts']) {
    // Comments stripped: the notes explaining the rule mention discounts, and
    // a whole-file search would match that prose rather than any markup.
    check(`${doc} prints nothing about it`,
      /discount/i.test(readSourceWithoutComments(doc)), false);
  }

  section('and the discount can be set on both screens');
  for (const [name, row] of [
    ['bill line', 'components/BillItemRow.tsx'],
    ['quotation line', 'components/QuotationItemRow.tsx'],
  ]) {
    check(`the ${name} offers it`, readSource(row).includes('<DiscountField'), true);
    check(`and feeds it into the line total`,
      /discount: line\.discount/.test(readSource(row)), true);
  }
}

module.exports = { run };
