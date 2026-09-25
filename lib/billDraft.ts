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

import type { BillWithItems, NewBill, NewBillItem } from '@/db/bills';
import type { Customer } from '@/lib/customer';
import { calculateBill, storedDiscount, type SupplyType } from '@/lib/gst';
import { isBillUnit } from '@/lib/units';
import type { PaymentType } from '@/lib/payment';
import type { CartLine } from '@/store/cart';

export type BillDraftInput = {
  lines: CartLine[];
  customer: Customer;
  supplyType: SupplyType;
  /** Required by the time a bill is built — the screen blocks without it. */
  paymentType: PaymentType;
  paid: boolean;
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
      discount: line.discount,
    })),
    supplyType,
    { roundToNearestRupee: true }
  );

  const items: NewBillItem[] = lines.map((line, index) => {
    const computed = result.lines[index];
    return {
      // Real ids are positive. A line carrying anything else has no inventory
      // record behind it — a quotation line whose product was deleted, which
      // `quotationToCartLines` gives a negative stand-in so the cart can still
      // key by id. `bill_items.product_id` is a foreign key, so that stand-in
      // must not reach it; NULL is what "no product" already means there, and
      // it is also what stops `createBill` trying to reduce stock that is gone.
      product_id: line.productId > 0 ? line.productId : null,
      // The snapshot from the cart, not a fresh read of the product: the
      // customer was quoted this name at this price, and editing the product
      // afterwards must not rewrite history.
      product_name_snapshot: line.name,
      hsn_code_snapshot: line.hsnCode,
      qty: line.qty,
      unit: line.unit,
      // The price as entered, BEFORE the discount. Together with the basis and
      // the discount below it, this is what lets an edit rebuild the line
      // exactly rather than working backwards from a figure the discount has
      // already been taken out of.
      unit_price_snapshot: line.unitPrice,
      gst_rate_snapshot: line.gstRate,
      price_includes_gst: line.priceIncludesGst ? 1 : 0,
      discount_type: line.discount?.type ?? null,
      discount_value: line.discount?.value ?? null,
      // What the discount actually took off, after clamping and rounding.
      // Stored rather than recomputed on read: it is money that was given
      // away, and it should read back as the same figure for ever.
      discount_amount: computed.discountAmount,
      taxable_value: computed.taxableValue,
      cgst_amount: computed.cgstAmount,
      sgst_amount: computed.sgstAmount,
      igst_amount: computed.igstAmount,
      line_total: computed.lineTotal,
    };
  });

  return {
    date: input.date,
    payment_type: input.paymentType,
    paid: input.paid,
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


// ---------------------------------------------------------------------------
// The other direction
// ---------------------------------------------------------------------------

/** Rebuilds cart lines from a saved bill, so it can be edited like any cart. */
export function billToCartLines(bill: BillWithItems): CartLine[] {
  return bill.items.map((item) => {
    const discount = storedDiscount(item.discount_type, item.discount_value);

    // Two ways back, and which one is correct depends on whether the line's
    // price basis was recorded.
    //
    // A line written since migration 011 carries `price_includes_gst`, so it is
    // rebuilt from exactly what was entered: the pre-discount price, its basis,
    // and the discount. That round-trips.
    //
    // An older line has no basis stored, so it is rebuilt from
    // `taxable_value / qty` as a pre-tax price — which reproduces the stored
    // figures exactly, and is safe precisely BECAUSE those lines carry no
    // discount. Using that derivation on a discounted line would be wrong
    // twice over: `taxable_value` is already the discounted figure, so
    // re-applying the discount would take it off a second time, and not
    // re-applying it would bake it into the price and lose the record of what
    // was actually given.
    const rebuildFromSnapshot = item.price_includes_gst !== null;

    return {
      // The cart keys by product id. A line whose product was deleted has none,
      // so it gets a negative stand-in — unique per line, never a real id, and
      // mapped back to NULL by `buildNewBill` before it reaches the database.
      productId: item.product_id ?? -(item.id + 1),
      name: item.product_name_snapshot,
      hsnCode: item.hsn_code_snapshot,
      unitPrice: rebuildFromSnapshot
        ? item.unit_price_snapshot
        : item.qty > 0
          ? item.taxable_value / item.qty
          : item.unit_price_snapshot,
      gstRate: item.gst_rate_snapshot,
      priceIncludesGst: rebuildFromSnapshot ? item.price_includes_gst === 1 : false,
      qty: item.qty,
      unit: isBillUnit(item.unit) ? item.unit : null,
      // Only a line that recorded its basis can carry a discount back, for the
      // reason above. An older line has none to carry.
      discount: rebuildFromSnapshot ? discount : null,
    };
  });
}
