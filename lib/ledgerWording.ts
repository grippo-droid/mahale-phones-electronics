/**
 * The strings in a payment ledger that say which WAY the money went (T10.4).
 *
 * ---------------------------------------------------------------------------
 * In `lib/` rather than beside the component for the reason `billToCartLines`
 * moved: the harness cannot load a `.tsx` at all — JSX is not type syntax Node
 * can strip — so anything declared in one is unreachable from a test. These
 * are plain data, and they are exactly the thing worth pinning, since the
 * failure they exist to prevent is a string reading the wrong direction.
 * ---------------------------------------------------------------------------
 */

/**
 * Every string in here that says which WAY the money went.
 *
 * ---------------------------------------------------------------------------
 * A bill's money comes IN and a purchase's goes OUT. The first attempt at this
 * was a single `emptyMessage` prop, which fixed the empty state and left four
 * other strings reading "received" on a screen where the shop is paying a
 * vendor — the same half-a-job as T9.9, where the visible figure was corrected
 * and the accessibility label and dialog were not.
 *
 * So it is ONE object holding all of them, with the two directions named below
 * rather than spelled at the call sites. A third ledger picks a side; it cannot
 * pick four strings and miss the fifth.
 *
 * The rest of the component is genuinely direction-neutral — "of", "still
 * owed", "Settled in full" read correctly either way — and is deliberately not
 * in here.
 * ---------------------------------------------------------------------------
 */
export type LedgerWording = {
  /** Shown when nothing has been recorded against this bill or purchase. */
  empty: string;
  /** Label and accessibility label on the amount field. */
  amount: string;
  /** Label on the date field. The accessibility label is built from it. */
  date: string;
  /** Title of the overpayment warning. */
  overTitle: string;
  /** Body of that warning, given the three figures already formatted. */
  overBody: (paid: string, total: string, over: string) => string;
};

/** Money coming in, against a bill. */
export const RECEIVED_WORDING: LedgerWording = {
  empty: 'Nothing recorded yet. Add a payment as the money comes in — it can come in parts.',
  amount: 'Amount received',
  date: 'Date received',
  overTitle: 'More than the bill',
  overBody: (paid, total, over) =>
    `That would make ${paid} received against a bill of ${total} — ${over} more than is owed.\n\nRecord it anyway?`,
};

/** Money going out, against a purchase from a vendor. */
export const PAID_WORDING: LedgerWording = {
  empty: 'Nothing paid yet. Record each payment as it goes out — it can go in parts.',
  amount: 'Amount paid',
  date: 'Date paid',
  overTitle: 'More than the purchase',
  overBody: (paid, total, over) =>
    `That would make ${paid} paid against a purchase of ${total} — ${over} more than is owed.\n\nRecord it anyway?`,
};
