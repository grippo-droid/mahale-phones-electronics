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
 * How the paid flag reads on screen.
 *
 * Three states, not two. NULL is not "unpaid": bills raised before this feature
 * existed have no status at all, and showing them as unpaid would put a debt on
 * the books that nobody recorded. `null` here means "say nothing about it".
 */
export type PaidState = 'paid' | 'unpaid' | 'unknown';

/** SQLite stores the flag as 1/0/NULL; this is the only place that is decoded. */
export function paidStateFrom(paid: number | null | undefined): PaidState {
  if (paid === null || paid === undefined) return 'unknown';
  return paid === 1 ? 'paid' : 'unpaid';
}
