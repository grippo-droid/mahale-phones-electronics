'use strict';

/**
 * The payment ledger (T9.2): migration, status, editing, and the pdf_path rule.
 *
 * What this cannot say anything about: the ledger modal, the amber-tint pill
 * beside the amber-fill one, or how any of it reads on a phone. No renderer.
 */

const { tempDir } = require('../harness/check');
const { initDatabase, runMigrations } = require('@/db/init');
const bills = require('@/db/bills');
const payments = require('@/db/payments');
const payment = require('@/lib/payment');
const { LATEST_SCHEMA_VERSION } = require('@/db/schema');
const SQLite = require('expo-sqlite');

const CUSTOMER = { name: 'A', phone: '9000000000', state: 'Madhya Pradesh' };

function billInput(n, total, extra) {
  return {
    invoice_number: `L-${n}`,
    customer_name: CUSTOMER.name,
    customer_phone: CUSTOMER.phone,
    customer_state: CUSTOMER.state,
    subtotal: total,
    cgst_total: 0,
    sgst_total: 0,
    igst_total: 0,
    grand_total: total,
    items: [
      {
        product_id: null,
        product_name_snapshot: 'Item',
        hsn_code_snapshot: null,
        qty: 1,
        unit: null,
        unit_price_snapshot: total,
        gst_rate_snapshot: 0,
        taxable_value: total,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        line_total: total,
      },
    ],
    ...extra,
  };
}

async function run({ check, section }) {
  const db = await initDatabase({ directory: tempDir('ledger') });

  section('paise, not floats');
  // These are not illustrative. They are cases where summing REAL rupees lands
  // STRICTLY BELOW the total, so the bill would read "Part paid" for ever with
  // nothing on screen to explain it.
  //
  // The first version of this check used 0.1 + 0.2 and thirds of 1000, and a
  // negative control removing the rounding still passed: those cases happen to
  // err UPWARD. A float example is not automatically a float test.
  check('a 648 bill settled with 512.17 + 135.83',
    payment.paymentTotalsFor(648, [512.17, 135.83]).state, 'paid');
  check('and nothing is left owing on it',
    payment.paymentTotalsFor(648, [512.17, 135.83]).outstanding, 0);
  check('a 1394 bill settled with 283.90 + 1110.10',
    payment.paymentTotalsFor(1394, [283.9, 1110.1]).state, 'paid');
  check('a 1264 bill settled in three parts',
    payment.paymentTotalsFor(1264, [1217.61, 5.31, 41.08]).state, 'paid');
  check('a genuine shortfall is still a shortfall',
    payment.paymentTotalsFor(648, [512.17, 135.82]).state, 'partial');

  section('the four states');
  check('nothing recorded', payment.paymentTotalsFor(500, []).state, 'unknown');
  check('some of it', payment.paymentTotalsFor(500, [200]).state, 'partial');
  check('all of it', payment.paymentTotalsFor(500, [500]).state, 'paid');
  check('more than all of it', payment.paymentTotalsFor(500, [600]).state, 'paid');
  // Recorded and then emptied is genuinely unpaid, not unknown: somebody did
  // record something about this bill.
  check('recorded then emptied is unpaid',
    payment.paymentTotalsFor(500, [], { hasEverRecorded: true }).state, 'unpaid');
  check('a zero entry is unpaid, not partial',
    payment.paymentTotalsFor(500, [0]).state, 'unpaid');

  section('what is owed, and what is over');
  check('outstanding', payment.paymentTotalsFor(500, [200]).outstanding, 300);
  check('never negative', payment.paymentTotalsFor(500, [600]).outstanding, 0);
  check('overpaid is reported separately', payment.paymentTotalsFor(500, [600]).overpaidBy, 100);
  check('and is zero when settled exactly', payment.paymentTotalsFor(500, [500]).overpaidBy, 0);
  check('isOverpaid warns above the total', payment.isOverpaid(500, [500.01]), true);
  check('and not at the total', payment.isOverpaid(500, [500]), false);

  section('recording, correcting and removing');
  const bill = await bills.createBill(billInput(1, 1000), db);
  check('a bill with nothing recorded starts empty',
    (await payments.listPayments(bill.id, db)).length, 0);

  await payments.recordPayment(bill.id, { amount: 400, paid_on: '2026-09-01' }, db);
  await payments.recordPayment(bill.id, { amount: 250, paid_on: '2026-09-05' }, db);
  let ledger = await payments.listPayments(bill.id, db);
  check('two instalments accumulate', ledger.length, 2);
  check('newest first', ledger[0].paid_on, '2026-09-05');
  check('which reads as partial', payments.totalsFor(1000, ledger).state, 'partial');
  check('with the balance shown', payments.totalsFor(1000, ledger).outstanding, 350);

  const second = ledger.find((row) => row.amount === 250);
  await payments.editPayment(second.id, { amount: 600, paid_on: '2026-09-05' }, db);
  ledger = await payments.listPayments(bill.id, db);
  check('a correction changes the entry in place', ledger.length, 2);
  check('and settles the bill', payments.totalsFor(1000, ledger).state, 'paid');
  check('an edit is recorded as one',
    ledger.find((row) => row.id === second.id).edited_at !== null, true);

  await payments.deletePayment(second.id, db);
  ledger = await payments.listPayments(bill.id, db);
  check('an entry can be removed outright', ledger.length, 1);
  check('and the status is worked out again',
    payments.totalsFor(1000, ledger).state, 'partial');

  section('every write drops the stored PDF');
  // The file prints the payments. One left on disk would be reshared under the
  // same invoice number showing a ledger that no longer exists.
  await bills.setBillPdfPath(bill.id, '/tmp/L-1.pdf', db);
  const write = await payments.recordPayment(bill.id, { amount: 10, paid_on: '2026-09-09' }, db);
  check('recording clears the path', (await bills.getBillById(bill.id, db)).pdf_path, null);
  check('and names the file for the caller to delete', write.staleInvoiceNumber, 'L-1');

  await bills.setBillPdfPath(bill.id, '/tmp/L-1.pdf', db);
  const latest = (await payments.listPayments(bill.id, db))[0];
  await payments.editPayment(latest.id, { amount: 11, paid_on: '2026-09-09' }, db);
  check('editing clears it too', (await bills.getBillById(bill.id, db)).pdf_path, null);

  await bills.setBillPdfPath(bill.id, '/tmp/L-1.pdf', db);
  await payments.deletePayment(latest.id, db);
  check('and so does deleting', (await bills.getBillById(bill.id, db)).pdf_path, null);

  const quiet = await payments.recordPayment(bill.id, { amount: 1, paid_on: '2026-09-09' }, db);
  check('a bill with no stored PDF names nothing', quiet.staleInvoiceNumber, null);

  section('the one-tap shortcut settles the balance');
  const tapped = await bills.createBill(billInput(2, 800), db);
  await payments.recordPayment(tapped.id, { amount: 300, paid_on: '2026-09-01' }, db);
  await payments.settleRemaining(tapped.id, db);
  const tappedLedger = await payments.listPayments(tapped.id, db);
  check('it adds one entry for what was left', tappedLedger.length, 2);
  check('of exactly the balance', payments.totalsFor(800, tappedLedger).paidAmount, 800);
  check('leaving the bill settled', payments.totalsFor(800, tappedLedger).state, 'paid');
  check('tapping a settled bill does nothing', await payments.settleRemaining(tapped.id, db), null);
  check('and adds no entry', (await payments.listPayments(tapped.id, db)).length, 2);

  section('and the tag decides what a tap means');
  check('unknown settles', payment.tagTapAction('unknown'), 'settle');
  check('unpaid settles', payment.tagTapAction('unpaid'), 'settle');
  check('partial settles', payment.tagTapAction('partial'), 'settle');
  // No un-pay: there is no honest answer to which of several instalments a
  // stray tap should remove.
  check('paid opens the bill instead', payment.tagTapAction('paid'), 'open');

  section('cash opens its ledger; credit does not');
  const cash = await bills.createBill(billInput(3, 250, { payment_type: 'Cash', paid: true }), db);
  check('a cash bill starts settled',
    payments.totalsFor(250, await payments.listPayments(cash.id, db)).state, 'paid');

  const credit = await bills.createBill(
    billInput(4, 250, { payment_type: 'Credit', paid: false }), db);
  check('a credit bill starts with nothing',
    (await payments.listPayments(credit.id, db)).length, 0);

  const unrecorded = await bills.createBill(billInput(5, 250), db);
  check('and nothing recorded writes nothing',
    (await payments.listPayments(unrecorded.id, db)).length, 0);

  const cashLedger = await payments.listPayments(cash.id, db);
  await payments.editPayment(cashLedger[0].id, { amount: 100, paid_on: '2026-09-01' }, db);
  check('the cash default can be reduced afterwards',
    payments.totalsFor(250, await payments.listPayments(cash.id, db)).state, 'partial');

  section('removing a bill removes its ledger');
  await db.runAsync('DELETE FROM bills WHERE id = ?', credit.id);
  check('no orphaned rows are left behind',
    (await db.getFirstAsync('SELECT COUNT(*) AS c FROM bill_payments WHERE bill_id = ?', credit.id)).c,
    0);

  section('parsing what the owner types');
  check('a date', payment.parsePaymentDate('05/09/2026'), '2026-09-05');
  check('a single-digit day', payment.parsePaymentDate('5/9/2026'), '2026-09-05');
  // 31 February is refused rather than rolled into March: a date that silently
  // becomes a different date is worse than one that is rejected.
  check('an impossible date is refused', payment.parsePaymentDate('31/02/2026'), null);
  check('junk is refused', payment.parsePaymentDate('tomorrow'), null);
  check('and it round-trips', payment.formatPaymentDate('2026-09-05'), '05/09/2026');
  check('a missing date formats as empty', payment.formatPaymentDate(null), '');
  check('an amount', payment.parsePaymentAmount('250.50'), 250.5);
  check('zero is refused', payment.parsePaymentAmount('0'), null);
  // A negative is a refund, not an instalment, and would quietly reduce what
  // the ledger says was received.
  check('a negative is refused', payment.parsePaymentAmount('-50'), null);

  section('migrating a shop that was already marking bills paid');
  const old = await SQLite.openDatabaseAsync('old.db', undefined, tempDir('ledger-old'));
  await old.execAsync(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT NOT NULL UNIQUE, date TEXT NOT NULL,
      customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, customer_address TEXT,
      customer_gstin TEXT, customer_state TEXT NOT NULL, subtotal REAL NOT NULL DEFAULT 0,
      cgst_total REAL NOT NULL DEFAULT 0, sgst_total REAL NOT NULL DEFAULT 0,
      igst_total REAL NOT NULL DEFAULT 0, round_off REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL DEFAULT 0, pdf_path TEXT, created_at TEXT NOT NULL,
      payment_type TEXT, paid INTEGER);
    INSERT INTO schema_version VALUES (1,'a','x'),(2,'b','x'),(3,'c','x'),(4,'d','x'),(5,'e','x'),(6,'f','x'),(7,'g','x'),(8,'h','x'),(9,'i','x');
    INSERT INTO bills (invoice_number, date, customer_name, customer_phone, customer_state, grand_total, paid, created_at)
      VALUES ('WAS-PAID',   '2026-05-01T00:00:00.000Z', 'C', '9', 'Madhya Pradesh', 1500, 1,    '2026-05-01'),
             ('WAS-UNPAID', '2026-05-02T00:00:00.000Z', 'C', '9', 'Madhya Pradesh',  900, 0,    '2026-05-02'),
             ('WAS-SILENT', '2026-05-03T00:00:00.000Z', 'C', '9', 'Madhya Pradesh',  700, NULL, '2026-05-03');
  `);
  await runMigrations(old);

  const rows = await old.getAllAsync(
    `SELECT b.invoice_number AS inv, p.amount AS amount, p.paid_on AS paid_on
       FROM bills b LEFT JOIN bill_payments p ON p.bill_id = b.id
      ORDER BY b.invoice_number`
  );
  const byInvoice = Object.fromEntries(rows.map((r) => [r.inv, r]));

  check('a bill already marked paid gets one entry', byInvoice['WAS-PAID'].amount, 1500);
  // The amount was knowable; the date never was. Inventing one would print a
  // date on a customer's reprinted invoice that nobody ever entered.
  check('carrying no date, because none was ever recorded', byInvoice['WAS-PAID'].paid_on, null);
  check('and it reads as paid',
    payment.paymentTotalsFor(1500, [byInvoice['WAS-PAID'].amount]).state, 'paid');
  check('a bill marked not paid gets nothing', byInvoice['WAS-UNPAID'].amount, null);
  // NULL has always meant "never recorded". A zero-payment ledger would be the
  // same invention in the other direction.
  check('and one with nothing recorded gets nothing', byInvoice['WAS-SILENT'].amount, null);

  check('the schema is brought fully forward',
    (await old.getFirstAsync('SELECT MAX(version) AS v FROM schema_version')).v,
    LATEST_SCHEMA_VERSION);
}

module.exports = { run };
