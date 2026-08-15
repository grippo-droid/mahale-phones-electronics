import type { SQLiteDatabase } from 'expo-sqlite';

import { calculateLine, round2, supplyTypeFor } from '@/lib/gst';

import { createBill, type NewBillItem } from './bills';
import { getDatabase } from './init';
import { countProducts, createProduct, type NewProduct, type Product } from './products';

/**
 * Sample data for verifying the database layer before any real UI exists (T1.5).
 *
 * ============================================================================
 * !!! DEVELOPMENT ONLY — THIS IS NOT REAL SHOP DATA !!!
 * ============================================================================
 *
 * Nothing here runs automatically. Seeding only happens when it is explicitly
 * triggered, so it can never overwrite the shop's real inventory by accident.
 *
 * The HSN codes and GST rates below are PLAUSIBLE PLACEHOLDERS chosen to make
 * the sample data look realistic. They are NOT verified tax classifications —
 * confirm every real product's HSN code and GST slab with your accountant before
 * the shop bills a customer with them.
 *
 * Clear this data (`clearAllData`) before handing the app over for real use.
 */

/** Sample-only. The real business state comes from Settings in T4.1. */
const SAMPLE_BUSINESS_STATE = 'Maharashtra';

export const SAMPLE_PRODUCTS: NewProduct[] = [
  // --- CCTV ---
  { name: 'Hikvision Dome Camera 2MP', category: 'CCTV', brand: 'Hikvision', model_number: 'DS-2CE5AD0T',
    stock_qty: 12, unit_price: 1450, gst_rate: 18, hsn_code: '85258900' },
  { name: 'CP Plus Bullet Camera 2.4MP', category: 'CCTV', brand: 'CP Plus', model_number: 'CP-USC-TA24PL2',
    stock_qty: 8, unit_price: 1690, gst_rate: 18, hsn_code: '85258900' },
  { name: 'Hikvision DVR 4 Channel', category: 'CCTV', brand: 'Hikvision', model_number: 'DS-7104HGHI',
    stock_qty: 4, unit_price: 3200, gst_rate: 18, hsn_code: '85219090', low_stock_threshold: 3 },
  { name: 'CCTV Power Supply 4CH', category: 'CCTV', brand: 'Generic',
    stock_qty: 2, unit_price: 650, gst_rate: 18, hsn_code: '85044090' },

  // --- RO water purifiers ---
  { name: 'Kent Grand Plus RO 8L', category: 'RO', brand: 'Kent', model_number: '11015',
    stock_qty: 3, unit_price: 15500, gst_rate: 18, hsn_code: '84212190', low_stock_threshold: 2 },
  { name: 'Aquaguard Aura RO+UV', category: 'RO', brand: 'Eureka Forbes',
    stock_qty: 5, unit_price: 12900, gst_rate: 18, hsn_code: '84212190' },
  { name: 'RO Membrane 80 GPD', category: 'RO', brand: 'Generic',
    stock_qty: 25, unit_price: 850, gst_rate: 18, hsn_code: '84219900' },
  { name: 'RO Sediment Filter 10 inch', category: 'RO', brand: 'Generic',
    stock_qty: 40, unit_price: 120, gst_rate: 18, hsn_code: '84219900' },

  // --- Tube lights (marked MRP — the customer pays the price on the box) ---
  { name: 'Philips LED Batten 20W', category: 'Tube Light', brand: 'Philips',
    stock_qty: 30, unit_price: 420, gst_rate: 12, hsn_code: '94054900',
    price_includes_gst: true },
  { name: 'Havells LED Tube Light 18W', category: 'Tube Light', brand: 'Havells',
    stock_qty: 18, unit_price: 380, gst_rate: 12, hsn_code: '94054900',
    price_includes_gst: true },
  { name: 'Syska LED Batten 22W', category: 'Tube Light', brand: 'Syska',
    stock_qty: 4, unit_price: 350, gst_rate: 12, hsn_code: '94054900',
    price_includes_gst: true },

  // --- Bulbs (marked MRP) ---
  { name: 'Philips LED Bulb 9W', category: 'Bulb', brand: 'Philips',
    stock_qty: 60, unit_price: 90, gst_rate: 12, hsn_code: '85395000',
    price_includes_gst: true },
  { name: 'Wipro LED Bulb 12W', category: 'Bulb', brand: 'Wipro',
    stock_qty: 45, unit_price: 130, gst_rate: 12, hsn_code: '85395000',
    price_includes_gst: true },
  { name: 'Orient LED Bulb 5W', category: 'Bulb', brand: 'Orient',
    stock_qty: 0, unit_price: 70, gst_rate: 12, hsn_code: '85395000',
    price_includes_gst: true },

  // --- Wiring & Electrical ---
  { name: 'Copper Wire 1.5mm (90m roll)', category: 'Wiring & Electrical', brand: 'Finolex',
    stock_qty: 15, unit_price: 1250, gst_rate: 18, hsn_code: '85444910' },
  { name: 'MCB 16A Single Pole', category: 'Wiring & Electrical', brand: 'Havells',
    stock_qty: 22, unit_price: 240, gst_rate: 18, hsn_code: '85362000' },
  { name: 'Extension Board 4 Socket', category: 'Wiring & Electrical', brand: 'Anchor',
    stock_qty: 1, unit_price: 320, gst_rate: 18, hsn_code: '85366990' },

  // --- Other ---
  { name: 'Universal Remote for DVR', category: 'Other', brand: 'Generic',
    stock_qty: 7, unit_price: 180, gst_rate: 18, hsn_code: '85269200' },
];

export type SeedResult = {
  productsCreated: number;
  billsCreated: number;
};

/**
 * Inserts the sample catalogue and two sample bills.
 *
 * Refuses to run if products already exist, unless `force` is set — the guard
 * exists so this can never be fired at a database that holds real shop data.
 */
export async function seedDatabase(
  { force = false }: { force?: boolean } = {},
  db: SQLiteDatabase = getDatabase()
): Promise<SeedResult> {
  const existing = await countProducts(db);
  if (existing > 0 && !force) {
    throw new Error(
      `Database already has ${existing} products. Clear the data first if you really want to reseed.`
    );
  }

  const created: Product[] = [];
  for (const product of SAMPLE_PRODUCTS) {
    created.push(await createProduct(product, db));
  }

  const byName = (name: string) => {
    const found = created.find((product) => product.name === name);
    if (!found) throw new Error(`Sample product "${name}" missing.`);
    return found;
  };

  // Bill 1 — intra-state (CGST + SGST), two line items.
  const dome = byName('Hikvision Dome Camera 2MP');
  const dvr = byName('Hikvision DVR 4 Channel');
  const bill1Items = [
    buildSampleItem(dome, 2, SAMPLE_BUSINESS_STATE),
    buildSampleItem(dvr, 1, SAMPLE_BUSINESS_STATE),
  ];

  await createBill(
    {
      invoice_number: 'SAMPLE/0001',
      date: daysAgo(1),
      customer_name: 'Ramesh Patil',
      customer_phone: '9876543210',
      customer_address: 'Shop 4, Market Road, Nashik',
      customer_state: SAMPLE_BUSINESS_STATE,
      ...totalsFor(bill1Items),
      items: bill1Items,
    },
    db
  );

  // Bill 2 — inter-state (IGST), B2B with a customer GSTIN.
  const kent = byName('Kent Grand Plus RO 8L');
  const bill2Items = [buildSampleItem(kent, 1, 'Gujarat')];

  await createBill(
    {
      invoice_number: 'SAMPLE/0002',
      date: new Date(),
      customer_name: 'Sunita Traders',
      customer_phone: '9123456780',
      customer_gstin: '24AAAAA0000A1Z5',
      customer_state: 'Gujarat',
      ...totalsFor(bill2Items),
      items: bill2Items,
    },
    db
  );

  return { productsCreated: created.length, billsCreated: 2 };
}

/** Wipes all data but keeps the schema. Used to reset between test runs. */
export async function clearAllData(db: SQLiteDatabase = getDatabase()): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    // bill_items goes first even though the cascade would handle it — being
    // explicit means this still works if the cascade is ever changed.
    await txn.execAsync(`
      DELETE FROM bill_items;
      DELETE FROM bills;
      DELETE FROM products;
    `);
  });
}

// ---------------------------------------------------------------------------
// Sample bill maths — uses lib/gst.ts, the same module that calculates real
// bills, so the seeded figures are a genuine check on it rather than a
// second implementation that could drift.
// ---------------------------------------------------------------------------

function buildSampleItem(product: Product, qty: number, customerState: string): NewBillItem {
  const supplyType = supplyTypeFor(SAMPLE_BUSINESS_STATE, customerState);
  const line = calculateLine(
    {
      unitPrice: product.unit_price,
      qty,
      gstRate: product.gst_rate,
      priceIncludesGst: product.priceIncludesGst,
    },
    supplyType
  );

  return {
    product_id: product.id,
    product_name_snapshot: product.name,
    hsn_code_snapshot: product.hsn_code,
    qty,
    // The pre-tax rate, which is what a GST invoice must show per unit.
    unit_price_snapshot: line.unitPriceExclusive,
    gst_rate_snapshot: product.gst_rate,
    taxable_value: line.taxableValue,
    cgst_amount: line.cgstAmount,
    sgst_amount: line.sgstAmount,
    igst_amount: line.igstAmount,
    line_total: line.lineTotal,
  };
}

function totalsFor(items: NewBillItem[]) {
  const sum = (pick: (item: NewBillItem) => number) =>
    round2(items.reduce((total, item) => total + pick(item), 0));

  return {
    subtotal: sum((item) => item.taxable_value),
    cgst_total: sum((item) => item.cgst_amount),
    sgst_total: sum((item) => item.sgst_amount),
    igst_total: sum((item) => item.igst_amount),
    grand_total: sum((item) => item.line_total),
  };
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}
