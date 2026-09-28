'use strict';

/**
 * How History groups its rows (T9.8): what is owed, and what day everything
 * else falls on.
 *
 * ---------------------------------------------------------------------------
 * This suite exists because the grouping used to live inside a `useMemo` in
 * the screen, where the harness cannot reach it. CLAUDE.md claimed a test held
 * the day-heading invariant; there wasn't one. It is in `lib/billSections.ts`
 * now, and this drives it.
 *
 * The two cases that decide whether any of this works:
 *
 *   - **A settled bill must never stay in "Money owed".** ₹512.17 + ₹135.83
 *     against ₹648 sums BELOW ₹648 in floating point, so the SQL pre-filter
 *     fetches it. Only the paise comparison drops it.
 *
 *   - **A day with one owed bill and one ordinary bill must not get two day
 *     headings.** The owed one is lifted out; the day keeps one heading.
 * ---------------------------------------------------------------------------
 */

const { tempDir, readSource, readSourceWithoutComments } = require('../harness/check');
const {
  buildPendingGroup,
  buildDaySections,
  buildHistorySections,
  describeOwed,
  totalOwed,
  OWED_SECTION,
} = require('@/lib/billSections');
const { billSettlement } = require('@/lib/payment');
const { initDatabase } = require('@/db/init');
const bills = require('@/db/bills');
const payments = require('@/db/payments');

const at = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm, 0);

/** A bill row as the repository returns one. `paid` matters: see billSettlement. */
function row(id, date, total, paid = 0, extra = {}) {
  return {
    id,
    invoice_number: `H-${id}`,
    date: date.toISOString(),
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    customer_state: 'Madhya Pradesh',
    grand_total: total,
    payment_type: 'Credit',
    paid,
    deleted_at: null,
    ...extra,
  };
}

function billInput(n, date, total, extra) {
  return {
    invoice_number: `H-${n}`,
    date,
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    customer_state: 'Madhya Pradesh',
    subtotal: total,
    cgst_total: 0, sgst_total: 0, igst_total: 0,
    grand_total: total,
    items: [{
      product_id: null, product_name_snapshot: 'Cable', hsn_code_snapshot: null,
      qty: 1, unit: null, unit_price_snapshot: total, gst_rate_snapshot: 0,
      taxable_value: total, cgst_amount: 0, sgst_amount: 0, igst_amount: 0,
      line_total: total,
    }],
    ...extra,
  };
}

/** Builds the `amountsFor` lookup the pure helpers take. */
const ledger = (map) => (billId) => map[billId] ?? [];

async function run({ check, section }) {
  section('a settled bill never stays in Money owed');
  // The ledger suite's case, carried through to the grouping: a 648 bill
  // settled with 512.17 + 135.83. The SQL pre-filter fetches it, and only the
  // paise comparison decides it is done. Were the verdict made in floating
  // point anywhere, a fully settled bill could sit at the top of "Money owed"
  // for ever with nothing on screen to explain it.
  const settled = row(1, at(2026, 9, 1), 648);
  const owedFromSettled = buildPendingGroup([settled], ledger({ 1: [512.17, 135.83] }));
  check('but the paise comparison drops it', owedFromSettled.length, 0);
  check('and it reads as paid', billSettlement(settled, [512.17, 135.83]).state, 'paid');
  // A genuine shortfall of one paisa is still owed.
  check('one paisa short is still owed',
    buildPendingGroup([settled], ledger({ 1: [512.17, 135.82] })).length, 1);

  section('two more awkward settlements');
  for (const [total, parts] of [[1394, [283.9, 1110.1]], [1264, [1217.61, 5.31, 41.08]]]) {
    const bill = row(2, at(2026, 9, 1), total);
    check(`${total} settled in ${parts.length} parts leaves nothing owed`,
      buildPendingGroup([bill], ledger({ 2: parts })).length, 0);
  }

  section('and the case where SQL’s own sum falls short');
  // Found by searching two-part splits rather than assumed: SQLite sums
  // 185.01 + 315.03 to 500.03999999999996, strictly BELOW the 500.04 bill they
  // settle. This is the bill that would be stranded in "Money owed" if the
  // comparison were ever made in SQL, and it is why the query pre-filters
  // rather than decides. The 648 case above does NOT show this -- SQLite sums
  // that one exactly -- so it could not have proved the point on its own.
  const awkward = row(6, at(2026, 9, 1), 500.04);
  check('the paise comparison calls it settled',
    billSettlement(awkward, [185.01, 315.03]).state, 'paid');
  check('so it is not owed',
    buildPendingGroup([awkward], ledger({ 6: [185.01, 315.03] })).length, 0);
  check('and nothing is left outstanding',
    billSettlement(awkward, [185.01, 315.03]).outstanding, 0);

  section('which states count as owed');
  const total = 1000;
  const cases = [
    ['nothing recorded, and nothing ever was', null, [], false],
    ['recorded as not paid when raised', 0, [], true],
    ['part paid', 0, [400], true],
    ['paid in full', 0, [1000], false],
    ['overpaid', 0, [1200], false],
    ['recorded then emptied', 1, [], true],
  ];
  for (const [label, paid, amounts, expected] of cases) {
    const bill = row(3, at(2026, 9, 1), total, paid);
    check(label, buildPendingGroup([bill], ledger({ 3: amounts })).length === 1, expected);
  }

  section('an ordinary credit bill is owed, which is the whole point');
  // createBill seeds a ledger row only when the bill is saved as paid, so every
  // credit sale starts with paid = 0 and an EMPTY ledger. Before billSettlement
  // that read `unknown`, and a group defined as "unpaid or partial" would have
  // been empty on exactly the bills it exists for.
  const credit = row(4, at(2026, 9, 1), 500, 0);
  check('its state is unpaid, not unknown', billSettlement(credit, []).state, 'unpaid');
  check('so it lands in the group', buildPendingGroup([credit], ledger({})).length, 1);
  // And the bill nobody ever recorded anything about stays out of it.
  const ancient = row(5, at(2024, 1, 1), 500, null);
  check('a bill predating all of this is unknown', billSettlement(ancient, []).state, 'unknown');
  check('and is not claimed as a debt', buildPendingGroup([ancient], ledger({})).length, 0);

  section('oldest first, because the question is who has owed longest');
  const three = [
    row(10, at(2026, 9, 20), 100),
    row(11, at(2026, 3, 2), 100),
    row(12, at(2026, 7, 9), 100),
  ];
  check('ordered oldest to newest',
    buildPendingGroup(three, ledger({})).map((e) => e.bill.id), [11, 12, 10]);

  // Two bills at the same instant: the older id is the older bill, so it goes
  // on top -- the opposite tie-break from the dated list, and deliberately so.
  const sameInstant = [row(21, at(2026, 5, 5), 100), row(20, at(2026, 5, 5), 100)];
  check('a tie goes to the lower id',
    buildPendingGroup(sameInstant, ledger({})).map((e) => e.bill.id), [20, 21]);

  section('a day with an owed bill and an ordinary one gets ONE heading');
  // The invariant the old grouping relied on and this feature breaks: rows
  // arrive newest-first, so consecutive same-day rows collapse. Lift one out to
  // the top and the day could end up with a heading on each side of it.
  const day = at(2026, 9, 24, 10, 0);
  const owedRow = row(30, day, 500, 0);
  const paidRow = row(31, at(2026, 9, 24, 15, 0), 500, 0);
  const laterRow = row(32, at(2026, 9, 24, 18, 0), 500, 0);
  const page = [laterRow, paidRow, owedRow]; // newest first, as listBills returns

  const owed = buildPendingGroup([owedRow], ledger({}));
  const sections = buildHistorySections(page, owed, at(2026, 9, 30));

  check('the owed group is first', sections[0].title, OWED_SECTION);
  check('and is marked as the owed one', sections[0].owed, true);
  // Across EVERY section, not just the dated ones. Checking only the dated
  // half cannot see the failure this guards: the owed group growing day
  // headings of its own, so 24 September gets one at the top and another
  // further down. A control that does exactly that slipped past the first
  // version of this check.
  const allTitles = sections.map((s) => s.title);
  check('no heading appears twice anywhere', allTitles.length, new Set(allTitles).size);
  check('the owed heading is not a date', sections[0].title, OWED_SECTION);
  check('only one section is the owed one', sections.filter((s) => s.owed).length, 1);
  const dayTitles = sections.filter((s) => !s.owed).map((s) => s.title);
  check('the day appears exactly once', dayTitles.length, 1);

  section('and the lifted bill is not shown twice');
  const allIds = sections.flatMap((s) => s.data.map((b) => b.id));
  check('every row appears once', allIds.length, new Set(allIds).size);
  check('the owed one is in the owed group', sections[0].data.map((b) => b.id), [30]);
  check('and not in the dated part',
    sections.filter((s) => !s.owed).flatMap((s) => s.data.map((b) => b.id)), [32, 31]);

  section('with nothing owed the list is exactly what it always was');
  const plain = buildHistorySections(page, [], at(2026, 9, 30));
  check('no owed section', plain.some((s) => s.owed), false);
  check('same sections as the day grouping alone',
    JSON.stringify(plain), JSON.stringify(buildDaySections(page, at(2026, 9, 30))));

  section('day headings still collapse only CONSECUTIVE rows');
  const spread = [
    row(40, at(2026, 9, 24, 18, 0), 100),
    row(41, at(2026, 9, 23, 9, 0), 100),
    row(42, at(2026, 9, 24, 8, 0), 100), // out of order: must NOT join the first
  ];
  const spreadSections = buildDaySections(spread, at(2026, 9, 30));
  check('an out-of-order row opens its own section', spreadSections.length, 3);

  section('the heading says how many and how much');
  const owedThree = buildPendingGroup(
    [row(50, at(2026, 1, 1), 1000), row(51, at(2026, 2, 1), 500)],
    ledger({ 50: [250] })
  );
  check('counts the bills', describeOwed(owedThree), `${OWED_SECTION} · 2 bills`);
  check('and one reads as one',
    describeOwed(owedThree.slice(0, 1)), `${OWED_SECTION} · 1 bill`);
  check('totals what is outstanding, not the bill values', totalOwed(owedThree), 1250);
  // Summed in paise, so a run of awkward balances cannot drift the heading.
  const pennies = buildPendingGroup(
    [row(60, at(2026, 1, 1), 100), row(61, at(2026, 1, 2), 100)],
    ledger({ 60: [99.9], 61: [0.1] })
  );
  check('a paise-level total is exact', totalOwed(pennies), 100);

  section('against a real database, through the real query');
  const db = await initDatabase({ directory: tempDir('history-sections') });

  // The settled-in-two-parts bill, written for real.
  const b1 = await bills.createBill(billInput(1, at(2026, 9, 1), 648, { payment_type: 'Credit' }), db);
  await payments.recordPayment(b1.id, { amount: 512.17, paid_on: '2026-09-02' }, db);
  await payments.recordPayment(b1.id, { amount: 135.83, paid_on: '2026-09-03' }, db);

  // An ordinary unpaid credit bill, older.
  const b2 = await bills.createBill(
    billInput(2, at(2026, 8, 1), 500, { payment_type: 'Credit', paid: false }), db);
  // A part-paid CASH bill: the ledger takes any amount against any type, so
  // this is money owed too and the group is not restricted by payment type.
  const b3 = await bills.createBill(
    billInput(3, at(2026, 8, 15), 900, { payment_type: 'Cash', paid: false }), db);
  await payments.recordPayment(b3.id, { amount: 400, paid_on: '2026-08-16' }, db);

  // The bill SQLite itself sums short. Written for real so the pre-filter, the
  // aggregate and the verdict are all exercised on the same row.
  const b4 = await bills.createBill(billInput(4, at(2026, 8, 20), 500.04), db);
  await payments.recordPayment(b4.id, { amount: 185.01, paid_on: '2026-08-21' }, db);
  await payments.recordPayment(b4.id, { amount: 315.03, paid_on: '2026-08-22' }, db);

  const candidates = await bills.listOutstandingCandidates({}, db);
  const ids = candidates.map((c) => c.invoice_number);
  check('the settled bill IS fetched as a candidate', ids.includes('H-1'), true);

  // What the aggregate actually returned, rather than what it ought to have.
  const shortRow = candidates.find((c) => c.id === b4.id);
  check('SQL fetched the short-summing bill too', shortRow !== undefined, true);
  check('and its own sum really is below the total',
    shortRow ? shortRow.paid_amount < shortRow.grand_total : null, true);

  const amounts = {};
  for (const candidate of candidates) {
    amounts[candidate.id] = (await payments.listPayments(candidate.id, db)).map((p) => p.amount);
  }
  const realOwed = buildPendingGroup(candidates, ledger(amounts));
  check('but is not owed', realOwed.some((e) => e.bill.id === b1.id), false);
  check('nor is the one SQL sums short', realOwed.some((e) => e.bill.id === b4.id), false);
  check('the unpaid credit bill is', realOwed.some((e) => e.bill.id === b2.id), true);
  check('and so is the part-paid cash one', realOwed.some((e) => e.bill.id === b3.id), true);
  check('oldest first', realOwed.map((e) => e.bill.invoice_number), ['H-2', 'H-3']);
  check('showing the balance, not the total',
    realOwed.map((e) => e.outstanding), [500, 500]);

  section('a deleted bill is not a debt');
  await bills.deleteBill(b2.id, { restoreStock: false }, db);
  const afterDelete = await bills.listOutstandingCandidates({}, db);
  check('it leaves the candidates', afterDelete.some((c) => c.id === b2.id), false);

  section('the filter bounds the owed group too');
  // Otherwise rows appear that the count above them does not count.
  const august = await bills.listOutstandingCandidates(
    { from: at(2026, 8, 1), to: at(2026, 8, 31) }, db);
  check('a date range narrows it', august.every((c) => c.date < at(2026, 9, 1).toISOString()), true);
  const searched = await bills.listOutstandingCandidates({ search: 'H-3' }, db);
  check('and so does a search', searched.map((c) => c.invoice_number), ['H-3']);
  check('a search matching nothing gives nothing',
    (await bills.listOutstandingCandidates({ search: 'nobody' }, db)).length, 0);

  section('the screen wires it up');
  const history = readSourceWithoutComments('app/(tabs)/history.tsx');
  check('the owed query runs with the same filter as the list',
    /listOutstandingCandidates\(\{ search, from, to \}\)/.test(history), true);
  check('the grouping comes from the shared module',
    history.includes('buildHistorySections'), true);
  check('the screen no longer groups inline', /let current: Section/.test(history), false);
  // The ledgers behind the owed rows have to be loaded, or their tags blank:
  // loadFor REPLACES what it holds rather than merging.
  check('owed ids are loaded on the first page',
    /loadFor\(\[\.\.\.owedCandidates\.map/.test(history), true);
  check('and re-passed when paging',
    /loadFor\(\[\.\.\.candidates\.map/.test(history), true);
  check('deleting drops it from the owed group too',
    /setCandidates\(\(current\) => current\.filter/.test(history), true);
  check('the balance is labelled', history.includes('owed</Text>'), true);

  section('the tag reads the bill, so credit sales stop saying "Not recorded"');
  check('History passes the bill', /state=\{stateFor\(item\)\}/.test(history), true);
  check('the Dashboard too',
    /state=\{stateFor\(row\)\}/.test(readSourceWithoutComments('app/(tabs)/dashboard.tsx')), true);
  check('and the bill screen uses the same definition',
    /billSettlement\(bill,/.test(readSourceWithoutComments('app/bill/[id].tsx')), true);
  // One definition of the comparison. SQL must never decide settlement.
  check('the repository does not compare paid against total exactly',
    /SUM\(p\.amount\), 0\) < b\.grand_total \+ 1/.test(readSource('db/bills.ts')), true);
}

module.exports = { run };
