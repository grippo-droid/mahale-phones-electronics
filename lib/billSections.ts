/**
 * How the History list is grouped (T9.8).
 *
 * ---------------------------------------------------------------------------
 * Two groups, and they are ordered by opposite rules.
 *
 *   - **Money owed** — every bill in the current filter with a balance still
 *     outstanding, OLDEST first. Oldest first because the question this group
 *     answers is "who has owed me longest", and the answer has to be the row
 *     the eye lands on first.
 *
 *   - **Everything else**, newest first, under the day headings History has
 *     always had.
 *
 * This lives here rather than in the screen's `useMemo` because it is the part
 * worth testing and a screen is the one place the harness cannot reach. That is
 * not a hypothetical: the "New Quotation" guard was first written inline in a
 * button handler, and a negative control removing it passed every check —
 * because the test had re-implemented the logic instead of calling it.
 *
 * It is also why the day grouping moved here with it. It was only ever correct
 * because `listBills` returns bills in date order, and this feature is exactly
 * what breaks that assumption: pull old bills to the top and a single day can
 * end up with two headings, one in each group. CLAUDE.md claimed a test held
 * that invariant; there wasn't one — it went in the September sweep. There is
 * one now.
 * ---------------------------------------------------------------------------
 */

import { billSettlement, type PaidState } from '@/lib/payment';
import { formatBillDay } from '@/lib/format';
import type { BillRow } from '@/db/schema';

/** The heading over the outstanding group. Also the id the screen tests against. */
export const OWED_SECTION = 'Money owed';

export type HistorySection = {
  title: string;
  /** True only for the outstanding group, which rows render differently. */
  owed: boolean;
  data: BillRow[];
};

export type PendingBill = {
  bill: BillRow;
  state: PaidState;
  /** What is still owed on it, in rupees. */
  outstanding: number;
};

/**
 * Which bills are still owed on, oldest first.
 *
 * `candidates` comes from `listOutstandingCandidates`, whose SQL deliberately
 * over-includes: it loosens its comparison by a rupee rather than deciding in
 * floating point, because the one definition of "settled" compares whole paise
 * as integers and a second definition in SQL would be free to disagree with it.
 * The verdict is made HERE, over the real ledger rows, by `billSettlement`.
 *
 * So a bill arriving in `candidates` means "look at this one", never "this one
 * is owed". ₹512.17 + ₹135.83 against a ₹648 bill is the case that matters:
 * SQL's float sum lands a hair under ₹648 and the bill is fetched, and the
 * paise comparison here then drops it. Without that split the customer's fully
 * settled bill would sit at the top of "Money owed" for ever.
 *
 * `unknown` is not owed. A bill with nothing ever recorded is not a debt — see
 * `billSettlement` for how that is told apart from a credit sale the owner did
 * record as unpaid.
 */
export function buildPendingGroup(
  candidates: BillRow[],
  amountsFor: (billId: number) => number[]
): PendingBill[] {
  const owed: PendingBill[] = [];

  for (const bill of candidates) {
    const totals = billSettlement(bill, amountsFor(bill.id));
    if (totals.state !== 'unpaid' && totals.state !== 'partial') continue;
    owed.push({ bill, state: totals.state, outstanding: totals.outstanding });
  }

  // Oldest first, and the tie broken the opposite way from the dated list:
  // there, two bills at the same instant show newest first; here the older id
  // is the older bill, so it goes on top. Both are "oldest debts first".
  owed.sort((a, b) => {
    if (a.bill.date !== b.bill.date) return a.bill.date < b.bill.date ? -1 : 1;
    return a.bill.id - b.bill.id;
  });

  return owed;
}

/**
 * The dated part of the list, grouped under one heading per day.
 *
 * Collapses CONSECUTIVE same-day rows, which is only correct because the rows
 * arrive newest-first from `listBills`. A day must never get two headings: the
 * list reads as though the bills between them belong somewhere else, and the
 * sticky heading then contradicts the rows under it as it scrolls.
 */
export function buildDaySections(bills: BillRow[], now?: Date): HistorySection[] {
  const out: HistorySection[] = [];
  let current: HistorySection | null = null;

  for (const bill of bills) {
    const title = formatBillDay(bill.date, now);
    if (!current || current.title !== title) {
      current = { title, owed: false, data: [] };
      out.push(current);
    }
    current.data.push(bill);
  }

  return out;
}

/**
 * The whole list: what is owed, then everything else by day.
 *
 * A bill in the owed group is REMOVED from the dated part rather than shown
 * twice. Two copies of one bill in a list the owner is working through is how a
 * payment gets recorded against it once and then looked for again.
 *
 * `pageBills` is the paged list and `owed` is not paged — the outstanding group
 * is fetched whole, because a truncated answer to "who owes me" is worse than a
 * long section, and in a shop this is tens of rows rather than thousands.
 */
export function buildHistorySections(
  pageBills: BillRow[],
  owed: PendingBill[],
  now?: Date
): HistorySection[] {
  const sections: HistorySection[] = [];

  if (owed.length > 0) {
    sections.push({
      title: OWED_SECTION,
      owed: true,
      data: owed.map((entry) => entry.bill),
    });
  }

  const owedIds = new Set(owed.map((entry) => entry.bill.id));
  const rest = pageBills.filter((bill) => !owedIds.has(bill.id));

  return sections.concat(buildDaySections(rest, now));
}

/** What the owed heading says: how many, and how much. */
export function describeOwed(owed: PendingBill[]): string {
  const bills = owed.length === 1 ? '1 bill' : `${owed.length} bills`;
  return `${OWED_SECTION} · ${bills}`;
}

/** The outstanding total, summed in paise so the heading cannot drift a paisa. */
export function totalOwed(owed: PendingBill[]): number {
  return owed.reduce((sum, entry) => sum + Math.round(entry.outstanding * 100), 0) / 100;
}
