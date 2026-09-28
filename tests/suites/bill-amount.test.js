'use strict';

/**
 * What a bill row puts in its amount slot (T9.9).
 *
 * ---------------------------------------------------------------------------
 * The reason this is a module and not a ternary in two screens: the visible
 * figure, the accessibility label and the edit/delete dialog are three
 * renderings of ONE decision, and in T9.8 they drifted — the row was changed to
 * show the balance while the label a screen reader announces and the dialog
 * body both went on reading the full total. The two that were wrong are the two
 * nobody looks at, so nothing about the screen looked wrong.
 *
 * So the checks here are not only "does it pick the right number" but "do all
 * three come from the same call".
 * ---------------------------------------------------------------------------
 */

const { readSourceWithoutComments } = require('../harness/check');
const { billAmountDisplay } = require('@/lib/billAmount');
const { billSettlement } = require('@/lib/payment');

/** A bill as the repository returns one. `paid` decides unknown vs unpaid. */
const bill = (total, paid = 0) => ({ grand_total: total, paid });

async function run({ check, section }) {
  section('a part-paid bill shows what is left');
  const part = billAmountDisplay(bill(900), [500]);
  check('the balance, not the total', part.amount, 400);
  check('and it says so', part.label, 'owed of ₹900.00');
  check('marked as a balance', part.isBalance, true);
  check('spoken unambiguously', part.speech, '₹400.00 owed of ₹900.00');

  section('the other three states are left alone');
  // An unpaid bill owes its whole total, so the total is already the right
  // figure -- swapping in an identical number under an "owed" label would be
  // noise. A paid one is settled. `unknown` is not a debt at all.
  const unpaid = billAmountDisplay(bill(900), []);
  check('Not Paid shows the total', unpaid.amount, 900);
  check('with no label', unpaid.label, null);
  check('and is not a balance', unpaid.isBalance, false);
  check('it is genuinely the unpaid state', billSettlement(bill(900), []).state, 'unpaid');

  const paid = billAmountDisplay(bill(900), [900]);
  check('Paid shows the total', paid.amount, 900);
  check('with no label', paid.label, null);

  const unknown = billAmountDisplay(bill(900, null), []);
  check('never recorded shows the total', unknown.amount, 900);
  check('with no label', unknown.label, null);
  check('and really is unknown', billSettlement(bill(900, null), []).state, 'unknown');

  const over = billAmountDisplay(bill(900), [1000]);
  check('overpaid shows the total', over.amount, 900);
  check('with no label', over.label, null);

  section('real money, including a fractional bill');
  // 185.01 against 500.04 -- the pair SQLite sums short. The balance has to
  // come out exactly 315.03, not 315.02999999999997.
  const fractional = billAmountDisplay(bill(500.04), [185.01]);
  check('the balance is exact', fractional.amount, 315.03);
  check('and reads correctly', fractional.speech, '₹315.03 owed of ₹500.04');
  check('and it is a balance', fractional.isBalance, true);
  // Settled by the second instalment, so no balance is shown at all.
  const settledFractional = billAmountDisplay(bill(500.04), [185.01, 315.03]);
  check('once settled it shows the total', settledFractional.amount, 500.04);
  check('with no label', settledFractional.label, null);

  // A three-part settlement that a float sum gets wrong.
  const threeParts = billAmountDisplay(bill(1264), [1217.61, 5.31, 41.08]);
  check('1264 settled in three parts shows the total', threeParts.amount, 1264);
  check('with no label', threeParts.label, null);
  // One paisa short is still part paid.
  const paiseShort = billAmountDisplay(bill(1264), [1217.61, 5.31, 41.07]);
  check('a paisa short is part paid', paiseShort.isBalance, true);
  check('owing exactly one paisa', paiseShort.amount, 0.01);

  section('under History’s heading the label is the bare word');
  // Every row there is owed by definition and the heading says so, so naming
  // the total on each row would repeat what the heading already carries.
  const grouped = billAmountDisplay(bill(900), [500], { underOwedHeading: true });
  check('the balance', grouped.amount, 400);
  check('labelled plainly', grouped.label, 'owed');
  // An unpaid bill in that group shows its whole total as the balance, which
  // is the honest figure under a heading that says this is money owed.
  const groupedUnpaid = billAmountDisplay(bill(900), [], { underOwedHeading: true });
  check('an unpaid one shows the whole total', groupedUnpaid.amount, 900);
  check('still labelled owed', groupedUnpaid.label, 'owed');
  check('and still a balance', groupedUnpaid.isBalance, true);
  // The spoken form names the total either way: a screen reader has no heading.
  check('but speech still names the total',
    grouped.speech, '₹400.00 owed of ₹900.00');

  section('the Dashboard row is not under a heading, so it names the total');
  const dashboard = billAmountDisplay(bill(900), [500]);
  check('its label carries the total', dashboard.label.includes('900'), true);
  check('History’s does not', grouped.label.includes('900'), false);

  section('the three renderings come from one call');
  const history = readSourceWithoutComments('app/(tabs)/history.tsx');
  const dash = readSourceWithoutComments('app/(tabs)/dashboard.tsx');

  check('History renders the row from it',
    /amount=\{billAmountDisplay\(item, amountsFor\(item\.id\)/.test(history), true);
  check('its label speaks the same object',
    /accessibilityLabel=\{`Bill \$\{bill\.invoice_number\}[^`]*\$\{amount\.speech\}/.test(history),
    true);
  check('and the actions dialog calls it too',
    /billAmountDisplay\(bill, amountsFor\(bill\.id\)/.test(history), true);

  check('the Dashboard renders the row from it',
    /amount=\{billAmountDisplay\(row, amountsFor\(row\.id\)\)\}/.test(dash), true);
  check('and its label speaks the same object',
    /accessibilityLabel=\{`Bill \$\{bill\.invoice_number\}[^`]*\$\{amount\.speech\}/.test(dash),
    true);

  // The drift this exists to prevent: no screen may format the bill's own
  // total into a row's amount slot or its label any more.
  for (const [name, source] of [['History', history], ['the Dashboard', dash]]) {
    check(`${name} no longer formats grand_total into the row`,
      /formatRupees\(bill\.grand_total\)/.test(source), false);
  }

  section('what must NOT change');
  // These measure what was BILLED, and are recorded as settled in CLAUDE.md.
  check('the Dashboard month total is still the billed figure',
    /formatRupees\(stats\?\.monthTotal \?\? 0\)/.test(dash), true);
  check('and the today figure too',
    /formatRupees\(stats\?\.todayTotal \?\? 0\)/.test(dash), true);
  check('History’s summary total is untouched',
    /formatRupees\(summary\.total\)/.test(history), true);
  check('the bill screen still prints the grand total',
    /formatRupees\(bill\.grand_total\)/.test(readSourceWithoutComments('app/bill/[id].tsx')), true);
  check('and the invoice does not learn about balances',
    /owed of/.test(readSourceWithoutComments('lib/pdf.ts')), false);
}

module.exports = { run };
