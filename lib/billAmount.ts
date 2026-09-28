/**
 * What goes in a bill row's amount slot (T9.9).
 *
 * ---------------------------------------------------------------------------
 * One decision, three places. The visible figure, the accessibility label and
 * the edit/delete dialog all have to say the same thing about the same bill —
 * and in T9.8 they did not: History's owed rows were changed to show the
 * balance while the label a screen reader announces and the dialog body both
 * went on reading out the full total. Nothing looked wrong, because the two
 * that were wrong are the two nobody sees.
 *
 * So the decision is made once, here, and the row renders `amount`/`label`
 * while the label and the dialog render `speech`. A screen cannot show one
 * figure and announce another without changing this function.
 *
 * The rule itself is short: only a PART-paid bill has a figure worth swapping
 * in. An unpaid bill owes its whole total, so the total is already the right
 * number, and a paid one is settled. `unknown` — nobody ever recorded anything
 * — is not a debt and is left alone.
 * ---------------------------------------------------------------------------
 */

import { billSettlement } from '@/lib/payment';
import { formatRupees } from '@/lib/format';

export type BillAmount = {
  /** The figure for the amount slot. */
  amount: number;
  /** The words beneath it, or null when this is simply the bill's total. */
  label: string | null;
  /** True when `amount` is a balance rather than what the bill came to. */
  isBalance: boolean;
  /**
   * The same decision as one unambiguous line, for a screen reader and for the
   * actions dialog. Always names the bill's total when a balance is shown:
   * neither of those has a heading or a column beside it to give the figure
   * context, and "four hundred rupees" alone on a nine-hundred-rupee bill is
   * the kind of thing that gets acted on.
   */
  speech: string;
};

export function billAmountDisplay(
  bill: { grand_total: number; paid: number | null },
  amounts: number[],
  options: {
    /**
     * True for rows already sitting under History's "Money owed" heading.
     *
     * There, every row is owed by definition, so the label is the bare word
     * and the heading carries the rest. A row on the Dashboard has no such
     * heading — it sits among ordinary recent bills — so it has to name the
     * total itself, or the smaller figure reads as the price.
     */
    underOwedHeading?: boolean;
  } = {}
): BillAmount {
  const totals = billSettlement(bill, amounts);
  const full = { amount: bill.grand_total, label: null, isBalance: false };

  if (options.underOwedHeading) {
    // The group's own rule: show what is left, whatever the state. An unpaid
    // bill's balance IS its total, which is the honest figure to put under a
    // heading that says this is money owed.
    return {
      amount: totals.outstanding,
      label: 'owed',
      isBalance: true,
      speech: speak(totals.outstanding, bill.grand_total),
    };
  }

  if (totals.state !== 'partial') {
    return { ...full, speech: formatRupees(bill.grand_total) };
  }

  return {
    amount: totals.outstanding,
    label: `owed of ${formatRupees(bill.grand_total)}`,
    isBalance: true,
    speech: speak(totals.outstanding, bill.grand_total),
  };
}

function speak(outstanding: number, grandTotal: number): string {
  return `${formatRupees(outstanding)} owed of ${formatRupees(grandTotal)}`;
}
