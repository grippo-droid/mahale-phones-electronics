/**
 * The date ranges offered on the History screen (T5.5).
 *
 * These live here rather than in the screen because the boundaries are easy to
 * get subtly wrong — a month that stops on the 30th, a "last month" that breaks
 * in January — and a wrong boundary silently hides a bill rather than failing
 * visibly. A pure module can be checked against the calendar without a phone.
 *
 * ---------------------------------------------------------------------------
 * Why presets rather than a two-date picker.
 *
 * The ticket asks for a date range filter. `listBills` already takes an
 * arbitrary `from`/`to`, so an exact range is a repository call away — what is
 * chosen here is only what the shop owner is offered.
 *
 * Fixed presets win for this user. A spinner date picker is two fiddly dialogs
 * to answer a question that is nearly always "today", "this month" or "last
 * month", and picking two arbitrary dates on a phone at a counter is slow. It
 * would also mean a new native dependency.
 *
 * The month presets are not arbitrary either: GST returns are filed per calendar
 * month, so "Last month" is exactly the set of bills that goes on the return.
 *
 * If the owner ever needs a genuinely arbitrary range, that is a picker on top
 * of a repository that already supports it — not a rewrite.
 * ---------------------------------------------------------------------------
 */

export type RangeKey = 'all' | 'today' | 'last7' | 'month' | 'lastMonth';

export type DateRange = {
  /** Undefined means unbounded. `listBills` widens both ends to the local day. */
  from?: Date;
  to?: Date;
};

/** Chip order, shortest span first — the common case is nearest the left edge. */
export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
];

/**
 * "Last 7 days" rather than "This week" on purpose. A calendar week needs a
 * start day, and there is no answer to that which is right for every shop —
 * Monday is the business convention, Sunday is what `en-IN` says. A rolling
 * seven days has no such convention to get wrong, and is closer to what is
 * actually being asked ("how has the last week gone").
 */
const LAST_N_DAYS = 7;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Day 0 of a month is the last day of the month before it, which is how the end
 * of a month is found without knowing its length or whether it is a leap year.
 */
function endOfMonth(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

export function resolveRange(key: RangeKey, now: Date = new Date()): DateRange {
  switch (key) {
    case 'all':
      return {};

    case 'today':
      return { from: startOfDay(now), to: startOfDay(now) };

    case 'last7':
      // Inclusive of today, so the span is six days back plus today.
      // Date normalises a negative day-of-month across the month boundary.
      return {
        from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (LAST_N_DAYS - 1)),
        to: startOfDay(now),
      };

    case 'month':
      // Runs to the end of the month, not to today. This is a record of what
      // happened, not a running total — a bill dated later in the month (the
      // date is settable) belongs to the month it is dated in.
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: endOfMonth(now.getFullYear(), now.getMonth()),
      };

    case 'lastMonth': {
      // Month -1 rolls back into the previous December on its own.
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from: first, to: endOfMonth(first.getFullYear(), first.getMonth()) };
    }
  }
}

/**
 * The range named as it would be said out loud, for the count line and the
 * empty state — "in July 2026" rather than "in the selected range".
 *
 * The months are named rather than called "this month" because the chip already
 * says that, and a figure that says which month it covers is one the owner can
 * check against a return without counting backwards.
 */
export function describeRange(key: RangeKey, now: Date = new Date()): string {
  const monthName = (date: Date) =>
    date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  switch (key) {
    case 'all':
      return 'in total';
    case 'today':
      return 'today';
    case 'last7':
      return `in the last ${LAST_N_DAYS} days`;
    case 'month':
      return `in ${monthName(now)}`;
    case 'lastMonth':
      return `in ${monthName(new Date(now.getFullYear(), now.getMonth() - 1, 1))}`;
  }
}
