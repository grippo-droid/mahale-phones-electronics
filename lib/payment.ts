/**
 * How a bill was settled: the payment type, and whether the money has arrived.
 *
 * Two fields rather than one, and that separation is the point. "Credit" says
 * how the sale was agreed; "Not Paid" says where the money is today. A credit
 * bill gets paid a fortnight later without stopping being a credit sale, and a
 * cash bill occasionally goes out unpaid when a customer is short and promises
 * to return. Collapsing them into one field would make the common case —
 * marking a credit bill paid — impossible to express.
 *
 * The payment type therefore supplies the *default* status and nothing more.
 */

/** What is stored in `bills.payment_type`. NULL means it was never recorded. */
export type PaymentType = 'Cash' | 'Credit';

/** The two options, in the order the selector shows them. */
export const PAYMENT_TYPES: readonly PaymentType[] = ['Cash', 'Credit'] as const;

/** True for one of the two. Anything else — including NULL — is not. */
export function isPaymentType(value: unknown): value is PaymentType {
  return value === 'Cash' || value === 'Credit';
}

/**
 * The status a bill starts with once a payment type is chosen: cash is money in
 * hand, credit is money owed. Only a starting point — the owner can change it
 * immediately and at any time afterwards.
 */
export function defaultPaidFor(type: PaymentType): boolean {
  return type === 'Cash';
}

/**
 * How a bill's settlement reads on screen.
 *
 * Four states. `unknown` is not `unpaid`: a bill raised before any of this
 * existed has nothing recorded either way, and showing it as unpaid would put a
 * debt on the books that nobody entered.
 *
 * `partial` is why the ledger replaced the flag. A customer paying half now and
 * half next week is ordinary, and two states could not say it.
 */
export type PaidState = 'paid' | 'partial' | 'unpaid' | 'unknown';

// ---------------------------------------------------------------------------
// Money, in paise
// ---------------------------------------------------------------------------

/**
 * Every comparison below happens in whole paise, as integers.
 *
 * Money is stored as REAL, and summing REALs does not land where arithmetic
 * says it should: three instalments of 333.33, 333.33 and 333.34 against a
 * 1,000 rupee bill come to 999.9999999999999. Compared with `>=` that bill is
 * "Partially Paid" for ever, a ten-thousandth of a paisa short, with no way for
 * the owner to clear it and nothing on screen to explain why.
 *
 * Rounding each amount to paise before summing also matches what the rest of
 * the app does — `lib/gst.ts` rounds to paise at every step for the same
 * reason.
 */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function sumPaise(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + toPaise(amount), 0);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type PaymentTotals = {
  /** What has been received, in rupees. */
  paidAmount: number;
  /** What is still owed, in rupees. Never negative — see `overpaidBy`. */
  outstanding: number;
  /** Rupees received beyond the bill total, or 0. Warned about, never blocked. */
  overpaidBy: number;
  state: PaidState;
};

/**
 * The bill's settlement, computed from its ledger and never stored.
 *
 * Not a column, deliberately. A stored status would be a second copy of
 * something the payment rows already say, free to disagree with them the moment
 * an entry is edited or deleted — the same reason `converted_bill_id` is the
 * only record of a quotation having converted.
 *
 * `hasLedger` distinguishes "no payments recorded" from "this bill predates all
 * of this". A bill with no payments and no history is `unknown`; one that has
 * had a payment entered and then deleted is genuinely `unpaid`, because somebody
 * did record something about it.
 */
export function paymentTotalsFor(
  grandTotal: number,
  amounts: number[],
  options: { hasEverRecorded?: boolean } = {}
): PaymentTotals {
  const totalPaise = toPaise(grandTotal);
  const paidPaise = sumPaise(amounts);

  const paidAmount = paidPaise / 100;
  const outstanding = Math.max(0, totalPaise - paidPaise) / 100;
  const overpaidBy = Math.max(0, paidPaise - totalPaise) / 100;

  const recorded = options.hasEverRecorded ?? amounts.length > 0;

  let state: PaidState;
  if (paidPaise <= 0) state = recorded ? 'unpaid' : 'unknown';
  else if (paidPaise >= totalPaise) state = 'paid';
  else state = 'partial';

  return { paidAmount, outstanding, overpaidBy, state };
}

// ---------------------------------------------------------------------------
// Entering a payment date
// ---------------------------------------------------------------------------

/**
 * A payment date, typed as dd/mm/yyyy.
 *
 * A text field rather than a spinner, for the reason the History filter uses
 * presets: a date picker is a native dependency this app has deliberately gone
 * without, and the field is pre-filled with today, which is the answer almost
 * every time.
 *
 * Returns the ISO date, or null if it is not a real one. Rejects 31/02 rather
 * than rolling it into March, because a date that silently becomes a different
 * date is worse than one that is refused.
 */
export function parsePaymentDate(text: string): string | null {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The inverse, for pre-filling the field from a stored date. */
export function formatPaymentDate(iso: string | null): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * What the owner typed as an amount, or null if it is not a usable figure.
 *
 * Zero and negatives are refused: a zero payment records nothing, and a
 * negative one is a refund, which is a different thing from an instalment and
 * would quietly reduce what the ledger says was received.
 */
export function parsePaymentAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

/**
 * What tapping the status tag means, given where the bill stands.
 *
 * It only ever moves a bill TOWARDS settled. There is no "un-pay": that would
 * mean deleting payment rows, and there is no honest answer to which of several
 * instalments a stray tap should remove. On a bill that is already paid the tap
 * opens the ledger instead, which is what someone tapping a Paid tag actually
 * wants — to see what was received and when.
 *
 * A decision rather than a branch inside a handler, so it is reachable from a
 * test. See CLAUDE.md on logic worth testing living somewhere testable.
 */
export type TagTap = 'settle' | 'open';

export function tagTapAction(state: PaidState): TagTap {
  return state === 'paid' ? 'open' : 'settle';
}

/** True when the entered payments come to more than the bill. Warns; never blocks. */
export function isOverpaid(grandTotal: number, amounts: number[]): boolean {
  return sumPaise(amounts) > toPaise(grandTotal);
}
