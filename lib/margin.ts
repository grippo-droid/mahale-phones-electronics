import { round2, splitPrice } from './gst';

/**
 * Profit and margin on a product (internal reference only).
 *
 * ============================================================================
 * Profit is measured against the PRE-TAX selling price, not the amount the
 * customer hands over.
 *
 * GST collected on a sale is not the shop's money — it is passed to the
 * government. A bulb marked ₹90 at 12% GST earns the shop ₹80.36; the remaining
 * ₹9.64 is tax. Comparing the ₹90 against a ₹70 cost would show ₹20 of profit
 * where only ₹10.36 exists, and a pricing decision made on that figure would be
 * wrong in the shop's favour — the worst direction for the error to run.
 * ============================================================================
 *
 * Purchase price is treated as a plain cost figure. If supplier invoices include
 * GST that is later reclaimed as input credit, the true cost is lower than what
 * is entered here and the real profit is correspondingly better. This is a
 * reference indicator to help set prices, not an accounting report.
 */

export type MarginResult = {
  /** Purchase price as entered. */
  cost: number;
  /** Pre-tax selling price — what the shop actually keeps per unit. */
  netSellingPrice: number;
  /** What the customer pays per unit, tax included. */
  customerPays: number;
  profit: number;
  /** Profit as a share of the pre-tax selling price. NULL if that price is 0. */
  marginPercent: number | null;
  /** Profit as a share of cost — "how much is added on". NULL if cost is 0. */
  markupPercent: number | null;
  /** True when the item would sell for less than it cost. */
  isLoss: boolean;
};

/**
 * Returns null when there is nothing meaningful to show — no purchase price
 * recorded, or no selling price entered yet.
 */
export function calculateMargin(
  purchasePrice: number | null | undefined,
  sellingUnitPrice: number,
  gstRate: number,
  priceIncludesGst: boolean
): MarginResult | null {
  if (purchasePrice === null || purchasePrice === undefined) return null;
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) return null;
  if (!Number.isFinite(sellingUnitPrice) || sellingUnitPrice <= 0) return null;

  const { exclusive, inclusive } = splitPrice(sellingUnitPrice, gstRate, priceIncludesGst);

  const cost = round2(purchasePrice);
  const netSellingPrice = exclusive;
  const profit = round2(netSellingPrice - cost);

  return {
    cost,
    netSellingPrice,
    customerPays: inclusive,
    profit,
    marginPercent: netSellingPrice > 0 ? round2((profit / netSellingPrice) * 100) : null,
    markupPercent: cost > 0 ? round2((profit / cost) * 100) : null,
    isLoss: profit < 0,
  };
}
