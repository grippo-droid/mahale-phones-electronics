'use strict';

/**
 * How dates read, and which date is meant (T9.7).
 *
 * ---------------------------------------------------------------------------
 * The cases here are boundaries, not samples. A date formatter is trivially
 * right in the middle of a month and wrong at exactly four places: midnight,
 * the turn of a month, the turn of a year, and the line between local time and
 * the UTC the value is stored in. Testing 15 September proves none of them.
 *
 * `now` is injectable in every formatter precisely so those boundaries can be
 * driven without waiting for one.
 * ---------------------------------------------------------------------------
 */

const { tempDir, readSource } = require('../harness/check');
const { formatDate, formatBillWhen, formatBillDay, formatTime } = require('@/lib/format');
const { initDatabase } = require('@/db/init');
const bills = require('@/db/bills');

/** A local wall-clock moment, so the tests describe what the shop sees. */
const at = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm, 0);

function billInput(invoice, date) {
  return {
    invoice_number: invoice,
    date,
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    customer_state: 'Madhya Pradesh',
    subtotal: 100, cgst_total: 0, sgst_total: 0, igst_total: 0, grand_total: 100,
    items: [{
      product_id: null, product_name_snapshot: 'Cable', hsn_code_snapshot: null,
      qty: 1, unit: null, unit_price_snapshot: 100, gst_rate_snapshot: 0,
      taxable_value: 100, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, line_total: 100,
    }],
  };
}

async function run({ check, section }) {
  section('midnight, which is where "today" stops');
  // A bill at 11pm is yesterday's bill at 1am -- compared on the local calendar
  // day, not on elapsed hours. Two hours apart, different answers.
  const lateLastNight = at(2026, 9, 24, 23, 30);
  const earlyThisMorning = at(2026, 9, 25, 1, 0);
  check('11:30pm reads as Yesterday at 1am',
    formatBillWhen(lateLastNight, earlyThisMorning).startsWith('Yesterday'), true);
  check('and as Today at 11:45pm the same night',
    formatBillWhen(lateLastNight, at(2026, 9, 24, 23, 45)).startsWith('Today'), true);
  // One minute either side of midnight.
  check('23:59 is not Today once the clock turns',
    formatBillWhen(at(2026, 9, 24, 23, 59), at(2026, 9, 25, 0, 1)).startsWith('Yesterday'), true);
  check('00:01 is Today at 00:02',
    formatBillWhen(at(2026, 9, 25, 0, 1), at(2026, 9, 25, 0, 2)).startsWith('Today'), true);

  section('the turn of a month');
  // `new Date(y, m, d - 1)` has to roll the month back, not land on day 0.
  check('31 August is Yesterday on 1 September',
    formatBillDay(at(2026, 8, 31), at(2026, 9, 1)), 'Yesterday');
  check('and 30 August is not',
    formatBillDay(at(2026, 8, 30), at(2026, 9, 1)) === 'Yesterday', false);

  section('the turn of a year');
  check('31 December is Yesterday on 1 January',
    formatBillDay(at(2025, 12, 31), at(2026, 1, 1)), 'Yesterday');
  check('and 1 January is Today on 1 January',
    formatBillDay(at(2026, 1, 1), at(2026, 1, 1)), 'Today');
  // A year earlier to the day must not read as Today.
  check('the same date a year back is neither',
    ['Today', 'Yesterday'].includes(formatBillDay(at(2025, 9, 25), at(2026, 9, 25))), false);

  section('a leap day is a real day');
  check('29 February formats', formatDate(at(2024, 2, 29)), '29/02/2024');
  check('and is Yesterday on 1 March',
    formatBillDay(at(2024, 2, 29), at(2024, 3, 1)), 'Yesterday');

  section('older dates carry the weekday, because a shop week has a shape');
  const older = formatBillDay(at(2026, 9, 1), at(2026, 9, 25));
  check('it is not Today or Yesterday', ['Today', 'Yesterday'].includes(older), false);
  check('and it names the day', /Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(older), true);
  check('with the year', older.includes('2026'), true);

  section('nonsense in, nothing out');
  // Better an empty slot than the words "Invalid Date" on a bill row.
  for (const [label, value] of [
    ['an unparseable string', 'not a date'],
    ['an empty string', ''],
    ['a bad ISO string', '2026-13-45T00:00:00.000Z'],
  ]) {
    check(`${label} formats as empty`, formatBillWhen(value), '');
    check(`${label} has no day either`, formatBillDay(value), '');
    check(`${label} has no time`, formatTime(value), '');
  }

  section('stored in UTC, read in local time');
  // The trap. A bill raised at 7pm in India is stored as the NEXT day in UTC,
  // because IST is UTC+5:30. Anything that compares the date portion of a
  // stored string against a local day is wrong -- and the way that shows up is
  // a late-evening sale landing in the wrong month's GST figures.
  const localDayOf = (d) => [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');

  // The last minute and the first minute of one local day. Unless the machine
  // is running in UTC, at least one of them is stored under a DIFFERENT date
  // than the one the shop would call it -- which is the whole trap.
  const justBefore = at(2026, 9, 30, 23, 45);
  const justAfter = at(2026, 9, 30, 0, 15);
  const shifts = (d) => d.toISOString().slice(0, 10) !== localDayOf(d);
  const inUtc = new Date().getTimezoneOffset() === 0;
  check('a stored day and a local day are not the same thing',
    inUtc ? !shifts(justBefore) && !shifts(justAfter) : shifts(justBefore) || shifts(justAfter),
    true);

  // So formatting must go through Date, never through the string's first ten
  // characters. Both of these are 30 September to the shop.
  for (const [label, moment] of [['23:45', justBefore], ['00:15', justAfter]]) {
    check(`a bill at ${label} shows as 30/09/2026`,
      formatDate(moment.toISOString()), '30/09/2026');
    check(`and the string and the Date agree at ${label}`,
      formatDate(moment.toISOString()), formatDate(moment));
  }

  section('and a late-evening bill is counted on the day it was made');
  // getSalesSummary widens its bounds to the local day for exactly this reason.
  // The Dashboard passes `new Date()` for both ends, so the query is made at
  // some moment DURING the day -- here 9am, hours before the sale. Without the
  // widening the range would be a single instant and the bill would vanish from
  // the day's takings, which is how a late sale lands in the wrong month.
  const db = await initDatabase({ directory: tempDir('dates') });
  await bills.createBill(billInput('T-1', justBefore), db);
  const askedInTheMorning = at(2026, 9, 30, 9, 0);
  const sameDay = await bills.getSalesSummary(askedInTheMorning, askedInTheMorning, db);
  check('an 11:45pm sale is in that day’s takings', sameDay.billCount, 1);
  check('and its money is counted', sameDay.total, 100);

  const nextDay = at(2026, 10, 1, 12, 0);
  const nextDayTakings = await bills.getSalesSummary(nextDay, nextDay, db);
  check('and not in the next day’s', nextDayTakings.billCount, 0);
  // The month bounds the Dashboard actually uses.
  const september = await bills.getSalesSummary(at(2026, 9, 1), at(2026, 9, 30), db);
  check('September claims it', september.billCount, 1);
  const october = await bills.getSalesSummary(at(2026, 10, 1), at(2026, 10, 31), db);
  check('October does not', october.billCount, 0);

  section('bills are ordered by their own date, newest first');
  await bills.createBill(billInput('T-2', at(2026, 9, 28, 10, 0)), db);
  await bills.createBill(billInput('T-3', at(2026, 10, 2, 10, 0)), db);
  const listed = await bills.listBills({}, db);
  check('newest first', listed.map((b) => b.invoice_number), ['T-3', 'T-1', 'T-2']);

  section('two bills at the very same instant still have an order');
  // Otherwise paging could show one twice and the other never.
  const sameInstant = at(2026, 11, 5, 15, 0);
  await bills.createBill(billInput('S-1', sameInstant), db);
  await bills.createBill(billInput('S-2', sameInstant), db);
  const tied = (await bills.listBills({}, db)).filter((b) => b.invoice_number.startsWith('S-'));
  check('the later row wins the tie', tied.map((b) => b.invoice_number), ['S-2', 'S-1']);

  section('a bill’s date is its creation date, and nothing moves it');
  // Four kinds of date live on a bill now. Only this one is "the date".
  const target = listed.find((b) => b.invoice_number === 'T-1');
  const originalDate = target.date;
  await bills.editBill(target.id, {
    customer_name: 'Ramesh',
    customer_phone: '9826351449',
    customer_state: 'Madhya Pradesh',
    subtotal: 200, cgst_total: 0, sgst_total: 0, igst_total: 0, grand_total: 200,
    items: [{
      product_id: null, product_name_snapshot: 'Cable', hsn_code_snapshot: null,
      qty: 2, unit: null, unit_price_snapshot: 100, gst_rate_snapshot: 0,
      taxable_value: 200, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, line_total: 200,
    }],
  }, db);
  const edited = await bills.getBillById(target.id, db);
  check('an edit does not move it', edited.date, originalDate);
  // Moving it would refile the sale in a different GST return period.
  check('even though the edit is recorded', edited.edited_at !== null, true);
  check('and the totals did change', edited.grand_total, 200);

  section('the date is on every surface that shows a bill');
  for (const [name, file, marker] of [
    ['the invoice', 'lib/pdf.ts', /<div class="label">Date<\/div>/],
    ['the quotation', 'lib/quotationPdf.ts', /<div class="label">Date<\/div>/],
    ['the Dashboard', 'app/(tabs)/dashboard.tsx', /formatBillWhen\(bill\.date\)/],
    ['History', 'app/(tabs)/history.tsx', /formatBillDay\(bill\.date\)/],
    ['the quotations list', 'app/(tabs)/quotations.tsx', /formatBillDay\(quotation\.date\)/],
    ['the bill screen', 'app/bill/[id].tsx', /formatDate\(bill\.date\)/],
    ['the quotation screen', 'app/quotation/[id].tsx', /formatDate\(quotation\.date\)/],
  ]) {
    check(`${name} shows it`, marker.test(readSource(file)), true);
  }

  section('and the time where two of the same day need telling apart');
  check('the quotations list',
    /formatTime\(quotation\.date\)/.test(readSource('app/(tabs)/quotations.tsx')), true);
  check('the bill screen', /formatTime\(bill\.date\)/.test(readSource('app/bill/[id].tsx')), true);
  check('the quotation screen',
    /formatTime\(quotation\.date\)/.test(readSource('app/quotation/[id].tsx')), true);
  // History rows deliberately carry only the time: the sticky heading above
  // them carries the day, and repeating it on every row is what the heading
  // was introduced to avoid.
  check('History rows keep the time alone',
    /formatTime\(bill\.date\)/.test(readSource('app/(tabs)/history.tsx')), true);

  section('the Date row means the bill’s own date, and no other');
  // Four kinds of date exist on a bill: when it was raised, when it was last
  // edited, when a payment came in, and when a PDF was rendered. Only the first
  // is "the Date". The other three each have a label of their own elsewhere, so
  // what has to hold here is that none of them reaches the header block.
  const header = readSource('app/bill/[id].tsx').split('Billed to')[0];
  check('no edit timestamp in the header', /edited_at/.test(header), false);
  check('no payment date in the header', /paid_on/.test(header), false);
  check('and it is not just showing now()', /formatDate\(new Date\(\)\)/.test(header), false);
}

module.exports = { run };
