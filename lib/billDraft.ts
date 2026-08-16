/**
 * Turning the bill in progress into something `db/bills.ts` can store (T3.6).
 *
 * This is the seam between the cart and the database. It is a pure function on
 * purpose: what gets written to a bill is the part of the app that must be
 * right, and it should be checkable without a screen or a database.
 *
 * The one rule it exists to enforce: **the figures written to `bill_items` are
 * the figures that were shown.** Both come from the same `calculateBill` call
 * here, rather than the screen totalling one way and the repository another. A
 * bill whose lines do not add up to its own total is not a bill anyone can
 * defend to a customer or an inspector.
 */

import type { NewBill, NewBillItem } from '@/db/bills';
import type { Customer } from '@/lib/customer';
import { calculateBill, type SupplyType } from '@/lib/gst';
import type { CartLine } from '@/store/cart';

export type BillDraftInput = {
  lines: CartLine[];
  customer: Customer;
  supplyType: SupplyType;
  /** Defaults to now. Passed in so a backdated bill can be tested. */
  date?: Date;
};

/**
 * Builds the bill payload and its line items from the cart.
 *
 * Deliberately does NOT set `invoice_number` — the caller passes
 * `generateInvoiceNumber` so the number is reserved inside the write
 * transaction. Handing a number out here would risk burning one on a bill that
 * then fails to save.
 */
export function buildNewBill(
  input: BillDraftInput
): Omit<NewBill, 'invoice_number' | 'generateInvoiceNumber'> {
  const { lines, customer, supplyType } = input;

  const result = calculateBill(
    lines.map((line) => ({
      unitPrice: line.unitPrice,
      qty: line.qty,
      gstRate: line.gstRate,
      priceIncludesGst: line.priceIncludesGst,
    })),
    supplyType,
    { roundToNearestRupee: true }
  );

  const items: NewBillItem[] = lines.map((line, index) => {
    const computed = result.lines[index];
    return {
      product_id: line.productId,
      // The snapshot from the cart, not a fresh read of the product: the
      // customer was quoted this name at this price, and editing the product
      // afterwards must not rewrite history.
      product_name_snapshot: line.name,
      hsn_code_snapshot: line.hsnCode,
      qty: line.qty,
      unit_price_snapshot: line.unitPrice,
      gst_rate_snapshot: line.gstRate,
      taxable_value: computed.taxableValue,
      cgst_amount: computed.cgstAmount,
      sgst_amount: computed.sgstAmount,
      igst_amount: computed.igstAmount,
      line_total: computed.lineTotal,
    };
  });

  return {
    date: input.date,
    customer_name: customer.name.trim(),
    customer_phone: customer.phone.trim(),
    customer_address: customer.address.trim() || null,
    customer_gstin: customer.gstin.trim() || null,
    customer_state: customer.state.trim(),
    subtotal: result.totals.subtotal,
    cgst_total: result.totals.cgstTotal,
    sgst_total: result.totals.sgstTotal,
    igst_total: result.totals.igstTotal,
    round_off: result.totals.roundOff,
    grand_total: result.totals.grandTotal,
    items,
  };
}

/**
 * Lines that will push recorded stock below zero, given stock read live from the
 * database. Used for the single confirmation before writing — see the note in
 * the Billing screen on why it is one dialog at the end rather than one per row.
 */
export type OversellLine = {
  name: string;
  qty: number;
  stockQty: number;
  /** How far below zero this line takes the count. Always positive. */
  shortfall: number;
};

export function findOversells(
  lines: CartLine[],
  stockById: Record<number, number>
): OversellLine[] {
  const oversells: OversellLine[] = [];

  for (const line of lines) {
    const stock = stockById[line.productId];
    // An unknown id means the product was deleted; there is no stock to go
    // negative, so it is a different problem and reported separately.
    if (stock === undefined) continue;
    if (stock - line.qty >= 0) continue;

    oversells.push({
      name: line.name,
      qty: line.qty,
      stockQty: stock,
      shortfall: line.qty - stock,
    });
  }

  return oversells;
}

/** Products removed from inventory while still sitting on the bill. */
export function findDeletedProducts(
  lines: CartLine[],
  stockById: Record<number, number>
): string[] {
  return lines.filter((line) => stockById[line.productId] === undefined).map((line) => line.name);
}
