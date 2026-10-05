'use strict';

/**
 * The payment ledger (T9.2): migration, status, editing, and the pdf_path rule.
 *
 * What this cannot say anything about: the ledger modal, the amber-tint pill
 * beside the amber-fill one, or how any of it reads on a phone. No renderer.
 */

const { tempDir, readSourceWithoutComments } = require('../harness/check');
const { initDatabase, runMigrations } = require('@/db/init');
const bills = require('@/db/bills');
const payments = require('@/db/payments');
const payment = require('@/lib/payment');
const ledgerCore = require('@/db/paymentLedger');
const wording = require('@/lib/ledgerWording');
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

  section('the amount field opens EMPTY, and the wording says which way the money went');
  // Both are T10.4, and both are source checks -- there is no renderer, so what
  // is held here is the shape of the mistake rather than a rendered dialog.
  const ledgerUi = readSourceWithoutComments('components/PaymentLedger.tsx');

  // The pre-fill: it used to open with the outstanding balance, which meant the
  // dialog pre-filled the one case it is not for (settling in full has its own
  // one-tap control) and left nothing able to tell a decision from an accepted
  // default afterwards.
  check('nothing seeds the box from the balance',
    /setAmountText\(.*outstanding/.test(ledgerUi), false);
  check('a new entry starts blank', ledgerUi.includes("setAmountText('')"), true);
  // Editing an EXISTING entry must still show its figure -- that is not a
  // default, it is the value being corrected.
  check('but editing one still shows what it was',
    /setAmountText\(String\(payment\.amount\)\)/.test(ledgerUi), true);

  // The wording: one object, both directions, so a third ledger cannot pick
  // four strings and miss the fifth the way the first attempt did.
  check('a received wording exists', typeof wording.RECEIVED_WORDING, 'object');
  check('and a paid one', typeof wording.PAID_WORDING, 'object');
  for (const key of ['empty', 'amount', 'date', 'overTitle', 'overBody']) {
    check(`both carry ${key}`,
      wording.RECEIVED_WORDING[key] !== undefined
        && wording.PAID_WORDING[key] !== undefined, true);
  }
  check('the bill side says received',
    wording.RECEIVED_WORDING.amount, 'Amount received');
  check('the purchase side says paid', wording.PAID_WORDING.amount, 'Amount paid');
  check('and their dates differ too',
    wording.RECEIVED_WORDING.date !== wording.PAID_WORDING.date, true);
  check('the overpay body names a bill',
    /bill/.test(wording.RECEIVED_WORDING.overBody('a', 'b', 'c')), true);
  check('and a purchase',
    /purchase/.test(wording.PAID_WORDING.overBody('a', 'b', 'c')), true);

  // No direction-specific literal may sit in the markup any more. The two
  // constants are the only place either word belongs.
  // The IDENTIFIER RECEIVED_WORDING is fine -- what must not come back is the
  // word as text the owner reads. The first version of this check grepped
  // case-insensitively and caught the import, which is the kind of false
  // positive that gets a real check deleted.
  const withoutIdentifier = ledgerUi.split('RECEIVED_WORDING').join('');
  check('no "received" text left in the component', /received/i.test(withoutIdentifier), false);
  check('nor "paid" as a label', /Amount paid|Date paid/.test(withoutIdentifier), false);
  check('the amount label comes from the wording',
    /\{wording\.amount\}/.test(ledgerUi), true);
  check('the date label too', /\{wording\.date\}/.test(ledgerUi), true);
  check('and the overpay warning', /wording\.overBody\(/.test(ledgerUi), true);

  section('the batched read, which draws every status tag in a list');
  // Added with the T10.1 extraction, and it was a genuine hole: nothing called
  // listPaymentsForBills at all. It is reached only from useBillPayments, a
  // React hook the harness cannot run -- so the one query behind every tag on
  // History and the Dashboard had no behavioural cover. A control that grouped
  // the rows by PAYMENT id instead of bill id passed all 693 checks.
  const second1 = await bills.createBill(billInput(50, 500), db);
  const second2 = await bills.createBill(billInput(51, 800), db);
  await payments.recordPayment(second1.id, { amount: 100, paid_on: '2026-09-02' }, db);
  await payments.recordPayment(second1.id, { amount: 150, paid_on: '2026-09-09' }, db);
  await payments.recordPayment(second2.id, { amount: 800, paid_on: '2026-09-03' }, db);
  const bare = await bills.createBill(billInput(52, 300), db);

  const batched = await payments.listPaymentsForBills(
    [second1.id, second2.id, bare.id], db);

  check('keyed by BILL id, not payment id', batched.has(second1.id), true);
  check('with that bill’s entries only', (batched.get(second1.id) ?? []).length, 2);
  check('and the other bill kept apart', (batched.get(second2.id) ?? []).length, 1);
  check('every row belongs to the bill it is filed under',
    (batched.get(second1.id) ?? []).every((row) => row.bill_id === second1.id)
      && (batched.get(second1.id) ?? []).length > 0, true);
  check('the other bucket too',
    (batched.get(second2.id) ?? []).every((row) => row.bill_id === second2.id)
      && (batched.get(second2.id) ?? []).length > 0, true);
  // A bill with nothing recorded is ABSENT rather than an empty array -- the
  // hook reads `ledgers.get(id) ?? []`, so both work, but absence is what the
  // query actually produces and the test should say which.
  check('a bill with no payments is not in the map', batched.has(bare.id), false);

  // The two reads must agree. They are one SELECT in paymentLedger.ts for
  // exactly this reason: an ordering that differed between them would show as
  // a ledger whose newest entry moved depending on which screen opened it.
  check('newest first inside a bucket',
    (batched.get(second1.id) ?? [])[0]?.paid_on ?? null, '2026-09-09');
  check('matching the single read',
    JSON.stringify(batched.get(second1.id) ?? []),
    JSON.stringify(await payments.listPayments(second1.id, db)));

  check('an empty request returns an empty map',
    (await payments.listPaymentsForBills([], db)).size, 0);
  check('and an unknown id simply is not there',
    (await payments.listPaymentsForBills([999999], db)).has(999999), false);

  section('the shared ledger core refuses anything but an identifier');
  // Both names are interpolated into SQL. They are module constants today, and
  // the change nobody would notice is a value arriving here from outside.
  let refused = null;
  try {
    await ledgerCore.listLedgerPayments(
      { table: 'bill_payments; DROP TABLE bills', ownerColumn: 'bill_id' }, 1, db);
  } catch (err) {
    refused = err.message;
  }
  check('a table name that is not an identifier throws', refused !== null, true);
  check('and says why', /identifier/i.test(refused || ''), true);
  check('the bills table is still there',
    (await db.getFirstAsync('SELECT COUNT(*) AS c FROM bills')).c > 0, true);

  let refusedColumn = null;
  try {
    await ledgerCore.listLedgerPayments(
      { table: 'bill_payments', ownerColumn: 'bill_id = 1 OR 1' }, 1, db);
  } catch (err) {
    refusedColumn = err.message;
  }
  check('an owner column that is not an identifier throws', refusedColumn !== null, true);

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
    -- A real database at schema 9 has these too. The fixture carried only
    -- bills until migration 011 began altering them, at which point the
    -- stand-in stopped resembling the thing it stands in for -- which is the
    -- same failure mode as a shim that is kinder than the real library.
    CREATE TABLE bill_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER NOT NULL, product_id INTEGER,
      product_name_snapshot TEXT NOT NULL, hsn_code_snapshot TEXT, qty INTEGER NOT NULL,
      unit TEXT, unit_price_snapshot REAL NOT NULL, gst_rate_snapshot REAL NOT NULL DEFAULT 0,
      taxable_value REAL NOT NULL DEFAULT 0, cgst_amount REAL NOT NULL DEFAULT 0,
      sgst_amount REAL NOT NULL DEFAULT 0, igst_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0);
    CREATE TABLE quotation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, quotation_id INTEGER NOT NULL, product_id INTEGER,
      product_name_snapshot TEXT NOT NULL, hsn_code_snapshot TEXT, qty INTEGER NOT NULL,
      unit TEXT, unit_price_snapshot REAL NOT NULL, gst_rate_snapshot REAL NOT NULL DEFAULT 0,
      price_includes_gst INTEGER NOT NULL DEFAULT 0, taxable_value REAL NOT NULL DEFAULT 0,
      gst_amount REAL NOT NULL DEFAULT 0, line_total REAL NOT NULL DEFAULT 0);
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
