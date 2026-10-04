'use strict';

/**
 * Vendors, purchases, and what the shop still owes for them (T10.3).
 *
 * ---------------------------------------------------------------------------
 * The purchase side is the mirror of bills, and the interesting checks are
 * where it deliberately does NOT mirror them:
 *
 *   - An empty ledger is UNPAID, never `unknown`. Bills need that fourth state
 *     because they predate their own ledger; purchases arrive with one, so
 *     there is nothing for `unknown` to mean and no `paid` column to express
 *     it. This is the single place the logic genuinely diverges, so it gets a
 *     control of its own.
 *   - Stock goes up, and only when the owner said so. `stock_applied` is
 *     stored for exactly that reason: a delete cannot otherwise know whether
 *     there is anything to take back.
 *   - A vendor's balance is clamped per purchase and never netted. Overpaying
 *     one bill must not quietly pay off another.
 * ---------------------------------------------------------------------------
 */

const { tempDir, readSourceWithoutComments } = require('../harness/check');
const { initDatabase } = require('@/db/init');
const { LATEST_SCHEMA_VERSION } = require('@/db/schema');
const vendors = require('@/db/vendors');
const purchases = require('@/db/purchases');
const purchasePayments = require('@/db/purchasePayments');
const products = require('@/db/products');
const { purchaseSettlement, vendorTotals } = require('@/lib/purchase');
const { resetShopData } = require('@/db/reset');

const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);

function line(product, qty, cost, extra = {}) {
  return {
    product_id: product ? product.id : null,
    product_name_snapshot: product ? product.name : 'Loose item',
    qty,
    unit: null,
    cost_price: cost,
    line_total: qty * cost,
    ...extra,
  };
}

async function newProduct(db, name, stock, cost) {
  return products.createProduct(
    {
      name,
      category: 'Other',
      stock_qty: stock,
      unit_price: cost * 2,
      gst_rate: 18,
      purchase_price: cost,
      price_includes_gst: false,
    },
    db
  );
}

async function run({ check, section }) {
  const db = await initDatabase({ directory: tempDir('purchases') });

  section('migration 012 is the schema this build expects');
  check('the schema version moved to 12', LATEST_SCHEMA_VERSION, 12);
  const tables = await db.getAllAsync(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
      ('vendors','purchases','purchase_items','purchase_payments') ORDER BY name`
  );
  check('all four tables exist', tables.map((t) => t.name),
    ['purchase_items', 'purchase_payments', 'purchases', 'vendors']);

  // Column for column with bill_payments, which is what lets one shared core
  // drive both ledgers.
  const ledgerCols = (await db.getAllAsync('PRAGMA table_info(purchase_payments)'))
    .map((c) => c.name).sort();
  const billCols = (await db.getAllAsync('PRAGMA table_info(bill_payments)'))
    .map((c) => (c.name === 'bill_id' ? 'purchase_id' : c.name)).sort();
  check('the ledger matches bill_payments column for column', ledgerCols, billCols);

  // No `paid` column, and that absence is the design -- see lib/purchase.ts.
  const purchaseCols = (await db.getAllAsync('PRAGMA table_info(purchases)'))
    .map((c) => c.name);
  check('purchases has no paid column', purchaseCols.includes('paid'), false);
  check('but does record whether stock moved', purchaseCols.includes('stock_applied'), true);
  check('and the vendor’s own bill number', purchaseCols.includes('vendor_ref'), true);

  section('an empty ledger is unpaid, never unknown');
  // THE divergence from bills. A bill with nothing recorded is `unknown`,
  // because it may predate the ledger entirely. A purchase cannot.
  check('nothing paid reads as unpaid',
    purchaseSettlement({ total_amount: 5000 }, []).state, 'unpaid');
  check('part paid', purchaseSettlement({ total_amount: 5000 }, [2000]).state, 'partial');
  check('settled', purchaseSettlement({ total_amount: 5000 }, [5000]).state, 'paid');
  check('and overpaid is still paid',
    purchaseSettlement({ total_amount: 5000 }, [6000]).state, 'paid');
  check('the balance is what is left',
    purchaseSettlement({ total_amount: 5000 }, [2000]).outstanding, 3000);
  // The same paise case the bill ledger uses: these sum BELOW the total in
  // floating point, and must still read as settled.
  check('an awkward settlement still clears',
    purchaseSettlement({ total_amount: 500.04 }, [185.01, 315.03]).state, 'paid');

  section('vendors');
  const sharma = await vendors.createVendor({ name: 'Sharma Electronics', phone: '9812345678' }, db);
  const patel = await vendors.createVendor({ name: 'Patel Traders' }, db);
  check('a vendor is stored', sharma.name, 'Sharma Electronics');
  check('with optional details left null', patel.phone, null);

  let nameless = null;
  try {
    await vendors.createVendor({ name: '   ' }, db);
  } catch (err) {
    nameless = err.message;
  }
  check('a vendor without a name is refused', nameless !== null, true);

  const listed = await vendors.listVendors(undefined, db);
  check('listed alphabetically', listed.map((v) => v.name), ['Patel Traders', 'Sharma Electronics']);
  check('and searchable by name',
    (await vendors.listVendors('patel', db)).map((v) => v.name), ['Patel Traders']);
  check('or by phone',
    (await vendors.listVendors('98123', db)).map((v) => v.name), ['Sharma Electronics']);

  section('recording a purchase, with stock');
  const cable = await newProduct(db, 'CCTV Cable 90m', 10, 400);
  const dome = await newProduct(db, 'Dome Camera', 2, 1200);

  const withStock = await purchases.createPurchase(
    {
      vendor_id: sharma.id,
      vendor_ref: 'SE/2026/88',
      date: at(2026, 9, 10),
      total_amount: 6800,
      items: [line(cable, 5, 400), line(dome, 4, 1200)],
      applyStock: true,
    },
    db
  );
  check('the purchase is stored', withStock.total_amount, 6800);
  check('with its lines', withStock.items.length, 2);
  check('the vendor reference is kept', withStock.vendor_ref, 'SE/2026/88');
  check('and it records that stock moved', withStock.stock_applied, 1);
  check('cable stock went up', (await products.getProductById(cable.id, db)).stock_qty, 15);
  check('and so did the cameras', (await products.getProductById(dome.id, db)).stock_qty, 6);
  // The cost price is a SEPARATE decision and was not opted into.
  check('the cost price is untouched',
    (await products.getProductById(cable.id, db)).purchase_price, 400);

  section('and without it');
  const noStock = await purchases.createPurchase(
    {
      vendor_id: patel.id,
      date: at(2026, 9, 12),
      total_amount: 900,
      items: [line(cable, 3, 300)],
      applyStock: false,
    },
    db
  );
  check('it records that stock did not move', noStock.stock_applied, 0);
  check('and the shelf is unchanged',
    (await products.getProductById(cable.id, db)).stock_qty, 15);

  section('updating the cost price is opt-in, per line');
  const withCost = await purchases.createPurchase(
    {
      vendor_id: sharma.id,
      date: at(2026, 9, 14),
      total_amount: 1500,
      items: [line(cable, 1, 450), line(dome, 1, 1050)],
      applyStock: false,
      // Only the cable. The camera's line is in the same purchase and must be
      // left alone -- the checkbox is per line, not per purchase.
      updateCostFor: [cable.id],
    },
    db
  );
  check('the opted-in product takes the new cost',
    (await products.getProductById(cable.id, db)).purchase_price, 450);
  check('the other one does not',
    (await products.getProductById(dome.id, db)).purchase_price, 1200);
  check('and stock still did not move',
    (await products.getProductById(dome.id, db)).stock_qty, 6);
  check('the purchase saved either way', withCost.items.length, 2);

  section('a line with no product behind it moves nothing');
  const loose = await purchases.createPurchase(
    {
      vendor_id: patel.id,
      date: at(2026, 9, 15),
      total_amount: 250,
      items: [line(null, 1, 250)],
      applyStock: true,
      updateCostFor: [cable.id],
    },
    db
  );
  check('it saves', loose.items.length, 1);
  check('with a null product', loose.items[0].product_id, null);
  check('and the cable is untouched by a purchase it is not on',
    (await products.getProductById(cable.id, db)).purchase_price, 450);

  section('the payment ledger, through the shared core');
  check('a new purchase owes all of it',
    purchasePayments.totalsFor(6800, await purchasePayments.listPurchasePayments(withStock.id, db))
      .state, 'unpaid');

  await purchasePayments.recordPurchasePayment(withStock.id, { amount: 2800, paid_on: '2026-09-11' }, db);
  await purchasePayments.recordPurchasePayment(withStock.id, { amount: 1000, paid_on: '2026-09-20' }, db);
  let ledger = await purchasePayments.listPurchasePayments(withStock.id, db);
  check('instalments accumulate', ledger.length, 2);
  check('newest first', ledger[0].paid_on, '2026-09-20');
  check('every row keyed to its purchase',
    ledger.every((row) => row.purchase_id === withStock.id), true);
  check('which reads as part paid',
    purchasePayments.totalsFor(6800, ledger).state, 'partial');
  check('with the balance', purchasePayments.totalsFor(6800, ledger).outstanding, 3000);

  const correction = ledger.find((row) => row.amount === 1000);
  await purchasePayments.editPurchasePayment(correction.id, { amount: 1500, paid_on: '2026-09-20' }, db);
  ledger = await purchasePayments.listPurchasePayments(withStock.id, db);
  check('a correction lands', purchasePayments.totalsFor(6800, ledger).outstanding, 2500);
  check('and is recorded as an edit',
    ledger.find((row) => row.id === correction.id).edited_at !== null, true);

  check('the one-tap shortcut settles the rest',
    await purchasePayments.settleRemainingPurchase(withStock.id, db), true);
  ledger = await purchasePayments.listPurchasePayments(withStock.id, db);
  check('leaving nothing owed', purchasePayments.totalsFor(6800, ledger).outstanding, 0);
  check('and it never over-settles',
    await purchasePayments.settleRemainingPurchase(withStock.id, db), false);

  await purchasePayments.deletePurchasePayment(correction.id, db);
  ledger = await purchasePayments.listPurchasePayments(withStock.id, db);
  check('an entry can be removed', ledger.length, 2);

  section('the batched read, for the vendor screen');
  const batched = await purchasePayments.listPaymentsForPurchases(
    [withStock.id, noStock.id], db);
  check('keyed by purchase', (batched.get(withStock.id) ?? []).length, 2);
  check('a purchase with no payments is absent', batched.has(noStock.id), false);

  section('the vendor rollup');
  const rollup = await vendors.listVendorsWithTotals(undefined, db);
  const sharmaRow = rollup.find((v) => v.id === sharma.id);
  check('counts their purchases', sharmaRow.purchaseCount, 2);
  check('sums what was bought', sharmaRow.purchased, 6800 + 1500);
  // 2800 + 2500 settled: the 1500 correction was deleted two sections above,
  // which is the point of checking the rollup AFTER the ledger is edited
  // rather than before.
  check('and what has been paid', sharmaRow.paid, 5300);
  // 1500 still owed on the first purchase, and all 1500 of the second.
  check('leaving what is owed', sharmaRow.owed, 3000);

  const direct = await vendors.getVendorTotals(sharma.id, db);
  check('the single-vendor rollup agrees', direct.owed, sharmaRow.owed);

  section('a vendor’s balance is clamped per purchase, never netted');
  // Overpaying one bill must not quietly pay off another. Netting would show a
  // vendor as square while a real debt sat under a credit they never agreed to.
  check('one overpaid and one unpaid still owes the unpaid one',
    vendorTotals([
      { total_amount: 1000, paidAmount: 1500 },
      { total_amount: 800, paidAmount: 0 },
    ]).owed,
    800);
  check('and the paid figure is what actually went out',
    vendorTotals([
      { total_amount: 1000, paidAmount: 1500 },
      { total_amount: 800, paidAmount: 0 },
    ]).paid,
    1500);
  // Summed in paise, so a run of awkward figures cannot drift the heading.
  check('paise-level totals are exact',
    vendorTotals([
      { total_amount: 0.1, paidAmount: 0 },
      { total_amount: 0.2, paidAmount: 0 },
    ]).owed,
    0.3);

  check('the Dashboard figure is every vendor together',
    await vendors.totalOwedToVendors(db),
    rollup.reduce((sum, v) => sum + v.owed, 0));

  section('finding a purchase');
  check('by the vendor’s own reference',
    (await purchases.listPurchases({ search: 'SE/2026' }, db)).map((p) => p.id), [withStock.id]);
  check('by vendor name',
    (await purchases.listPurchases({ search: 'Patel' }, db)).length, 2);
  check('by an item on it',
    (await purchases.listPurchases({ search: 'Dome' }, db)).length, 2);
  check('scoped to one vendor',
    (await purchases.listPurchases({ vendorId: patel.id }, db)).length, 2);
  check('newest first',
    (await purchases.listPurchases({ vendorId: sharma.id }, db)).map((p) => p.id),
    [withCost.id, withStock.id]);

  section('deleting a purchase');
  const before = (await products.getProductById(cable.id, db)).stock_qty;
  await purchases.deletePurchase(noStock.id, { reverseStock: true }, db);
  check('a purchase that never moved stock takes none back',
    (await products.getProductById(cable.id, db)).stock_qty, before);
  check('it leaves the lists',
    (await purchases.listPurchases({ vendorId: patel.id }, db)).some((p) => p.id === noStock.id),
    false);
  check('but the row survives, with its ledger',
    (await purchases.getPurchaseById(noStock.id, db)) !== null, true);

  await purchases.deletePurchase(withStock.id, { reverseStock: true }, db);
  check('one that did move stock gives it back',
    (await products.getProductById(cable.id, db)).stock_qty, before - 5);
  check('cameras too', (await products.getProductById(dome.id, db)).stock_qty, 2);

  // Deleting twice must not take the stock twice.
  await purchases.deletePurchase(withStock.id, { reverseStock: true }, db);
  check('deleting twice is a no-op',
    (await products.getProductById(cable.id, db)).stock_qty, before - 5);

  check('and a deleted purchase leaves the rollup',
    (await vendors.getVendorTotals(sharma.id, db)).purchaseCount, 1);

  section('a vendor with purchases cannot be removed');
  let refused = null;
  try {
    await vendors.deleteVendor(sharma.id, db);
  } catch (err) {
    refused = err.message;
  }
  check('it is refused', refused !== null, true);
  check('and says how many are in the way', /1 purchase/.test(refused || ''), true);
  check('the vendor is still there',
    (await vendors.getVendorById(sharma.id, db)) !== null, true);

  const spare = await vendors.createVendor({ name: 'Unused Supplier' }, db);
  await vendors.deleteVendor(spare.id, db);
  check('one with none can be', (await vendors.getVendorById(spare.id, db)), null);

  section('the screens are wired to the pieces above');
  // No renderer, so this reads source -- the same honest limit as every other
  // screen check here. What it holds is the wiring that is easy to get wrong
  // and invisible until a phone is in hand.
  const confirm = readSourceWithoutComments('components/PurchaseSaveConfirm.tsx');
  // A Modal, not an Alert: Android's Alert has no checkboxes at all, so this is
  // not a style choice. The same reason the reset confirmation is a Modal.
  check('the confirmation is a Modal', /<Modal/.test(confirm), true);
  check('and never an Alert', /Alert\.alert/.test(confirm), false);
  check('stock starts ticked', /useState\(true\)/.test(confirm), true);
  check('cost prices start empty', /useState<number\[\]>\(\[\]\)/.test(confirm), true);
  check('a free-text line is shown, not hidden',
    confirm.includes('Not in Inventory'), true);

  const newScreen = readSourceWithoutComments('app/purchase/new.tsx');
  check('saving goes through the confirmation',
    /<PurchaseSaveConfirm/.test(newScreen), true);
  check('and passes both answers to the repository',
    /applyStock: choice\.applyStock/.test(newScreen)
      && /updateCostFor: choice\.updateCostFor/.test(newScreen), true);
  // The total is what the vendor's bill says, not a figure this screen adds up.
  check('the total is typed, not summed',
    /total_amount: typedTotal/.test(newScreen), true);

  const detail = readSourceWithoutComments('app/purchase/[id].tsx');
  check('the purchase screen reuses the shared ledger',
    /<PaymentLedger/.test(detail), true);
  check('with wording for money going out',
    /emptyMessage=/.test(detail), true);
  // No Cash/Credit on a purchase -- there is no such decision being struck.
  check('and shows a status pill with no payment type',
    /paymentType=\{null\}/.test(detail), true);
  check('nothing here renders a PDF',
    /generateBillPdf|printAsync|pdf_path/.test(detail), false);

  const vendorList = readSourceWithoutComments('app/vendors/index.tsx');
  check('the vendor list shows what is owed', vendorList.includes('owed'), true);

  const dashboard = readSourceWithoutComments('app/(tabs)/dashboard.tsx');
  check('the Dashboard carries the vendor figure',
    /totalOwedToVendors\(\)/.test(dashboard), true);
  check('and opens the vendor list', /router\.push\('\/vendors'\)/.test(dashboard), true);

  const layout = readSourceWithoutComments('app/_layout.tsx');
  for (const route of ['vendors/index', 'vendors/[id]', 'purchase/new', 'purchase/[id]']) {
    // A dynamic route with no entry falls back to the route name, so the
    // header reads "[id]" while the screen loads.
    check(`${route} has a Stack entry`, layout.includes(`name="${route}"`), true);
  }

  section('reset takes the purchase side with it');
  const summary = await resetShopData(db);
  check('it reports the vendors removed', summary.vendors >= 2, true);
  check('and the purchases', summary.purchases >= 1, true);
  for (const table of ['vendors', 'purchases', 'purchase_items', 'purchase_payments']) {
    const left = await db.getFirstAsync(`SELECT COUNT(*) AS c FROM ${table}`);
    check(`${table} is empty afterwards`, left.c, 0);
  }
}

module.exports = { run };
