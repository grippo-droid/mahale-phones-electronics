/**
 * Turning the quotation in progress into something `db/quotations.ts` can
 * store, and back again when one is converted (T5.7).
 *
 * The mirror of `lib/billDraft.ts`, and pure for the same reason: what gets
 * written is the part that has to be right, and it should be checkable without
 * a screen or a database.
 */

import type { NewQuotation, NewQuotationItem, QuotationWithItems } from '@/db/quotations';
import { calculateBill } from '@/lib/gst';
import { isBillUnit, type BillUnit } from '@/lib/units';
import type { CartLine } from '@/store/cart';
import type { QuotationCustomer, QuotationLine } from '@/store/quotation';

export type QuotationDraftInput = {
  lines: QuotationLine[];
  customer: QuotationCustomer;
  /** Defaults to now. Passed in so a dated quotation can be tested. */
  date?: Date;
};

/**
 * Builds the quotation payload.
 *
 * Totalled as an INTER-state supply, which sounds wrong and is deliberate. A
 * quotation shows one GST figure rather than a CGST/SGST split, because which
 * heads apply is decided by the customer's state at the time of sale and a
 * quotation does not ask for it. Of the two routes to that single figure, the
 * inter-state one is the exact one: intra-state rounds half the rate twice and
 * lands a paisa away (see the note on `resolveSupplyType` in CLAUDE.md). Since
 * only the total is being shown, the accurate total is the one to show.
 *
 * The bill made from this recomputes with the real supply type, so it can
 * differ by up to a rupee after rounding. That is the same one-cart-in-a-
 * hundred effect already documented for bills, and it is why converting opens
 * an editable cart rather than writing a bill straight out.
 */
export function buildNewQuotation(input: QuotationDraftInput): NewQuotation {
  const { lines, customer } = input;

  const result = calculateBill(
    lines.map((line) => ({
      unitPrice: line.unitPrice,
      qty: line.qty,
      gstRate: line.gstRate,
      priceIncludesGst: line.priceIncludesGst,
    })),
    'inter-state',
    { roundToNearestRupee: true }
  );

  const items: NewQuotationItem[] = lines.map((line, index) => {
    const computed = result.lines[index];
    return {
      product_id: line.productId,
      product_name_snapshot: line.name,
      hsn_code_snapshot: line.hsnCode,
      qty: line.qty,
      unit: line.unit,
      unit_price_snapshot: line.unitPrice,
      gst_rate_snapshot: line.gstRate,
      price_includes_gst: line.priceIncludesGst,
      taxable_value: computed.taxableValue,
      gst_amount: computed.totalTax,
      line_total: computed.lineTotal,
    };
  });

  return {
    date: input.date,
    customer_name: customer.name.trim(),
    customer_phone: customer.phone.trim(),
    customer_address: customer.address.trim() || null,
    subtotal: result.totals.subtotal,
    gst_total: result.totals.totalTax,
    grand_total: result.totals.grandTotal,
    items,
  };
}

/**
 * Rebuilds cart lines from a stored quotation, for converting it to a bill.
 *
 * The QUOTED prices are used, not today's product prices: the customer was
 * offered these figures and the shop should honour them. The screen warns when
 * the quotation is old, and the cart stays editable, so choosing to reprice is
 * a decision the owner makes rather than one made silently on their behalf.
 *
 * A line whose product has since been deleted keeps its snapshot and its
 * `product_id` of NULL, exactly as a bill line would — it can still be billed,
 * there is simply no stock to reduce.
 */
export function quotationToCartLines(quotation: QuotationWithItems): CartLine[] {
  return quotation.items.map((item) => ({
    // The cart is keyed by product id. A deleted product has none, so it gets a
    // negative stand-in: unique per line, and never a real id.
    productId: item.product_id ?? -(item.id + 1),
    name: item.product_name_snapshot,
    hsnCode: item.hsn_code_snapshot,
    unitPrice: item.unit_price_snapshot,
    gstRate: item.gst_rate_snapshot,
    priceIncludesGst: item.price_includes_gst === 1,
    qty: item.qty,
    unit: asUnit(item.unit),
  }));
}

/** Stored units are plain TEXT; anything unrecognised becomes "no unit". */
function asUnit(unit: string | null): BillUnit | null {
  return isBillUnit(unit) ? unit : null;
}
