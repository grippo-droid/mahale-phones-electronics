import { paymentTotalsFor, type PaidState, type PaymentTotals } from '@/lib/payment';

/**
 * What is still owed on a purchase (T10.3).
 *
 * ---------------------------------------------------------------------------
 * The one place this genuinely differs from a bill, and it is worth stating
 * rather than discovering.
 *
 * `billSettlement` reads `bills.paid` to tell "the owner recorded this as
 * unpaid" from "nobody ever said anything" — a distinction that exists only
 * because bills predate their own ledger, and every bill raised before
 * migration 006 has nothing recorded either way.
 *
 * Purchases have no such history. The table arrives with the ledger, every row
 * is created by this feature, and the owner is answering for it at the moment
 * they save. So an empty ledger means UNPAID, full stop — `hasEverRecorded` is
 * unconditionally true and `unknown` cannot occur.
 *
 * That is why `purchases` has no `paid` column. A copy of it would be a second
 * record of a fact the ledger already holds, and it would introduce a state
 * with nothing to put in it.
 * ---------------------------------------------------------------------------
 */
export function purchaseSettlement(
  purchase: { total_amount: number },
  amounts: number[]
): PaymentTotals {
  return paymentTotalsFor(purchase.total_amount, amounts, { hasEverRecorded: true });
}

/** Three states here, never four. See above. */
export type PurchasePaidState = Exclude<PaidState, 'unknown'>;

/**
 * What a vendor owes across every purchase, for the rollup (T10.3).
 *
 * Summed in whole paise for the reason every other total here is: adding REAL
 * rupees does not land where arithmetic says, and a vendor who has been settled
 * exactly would otherwise sit at a fraction of a paisa outstanding for ever
 * with nothing on screen to explain it.
 */
export type VendorTotals = {
  purchased: number;
  paid: number;
  owed: number;
  purchaseCount: number;
};

export function vendorTotals(
  purchases: { total_amount: number; paidAmount: number }[]
): VendorTotals {
  let purchasedPaise = 0;
  let paidPaise = 0;
  let owedPaise = 0;

  for (const purchase of purchases) {
    const total = Math.round(purchase.total_amount * 100);
    const paid = Math.round(purchase.paidAmount * 100);
    purchasedPaise += total;
    paidPaise += paid;
    // Per purchase, and never below zero: overpaying one vendor bill does not
    // reduce what is owed on another. Netting them would hide a debt behind a
    // credit the vendor has not agreed to offset.
    owedPaise += Math.max(0, total - paid);
  }

  return {
    purchased: purchasedPaise / 100,
    paid: paidPaise / 100,
    owed: owedPaise / 100,
    purchaseCount: purchases.length,
  };
}
