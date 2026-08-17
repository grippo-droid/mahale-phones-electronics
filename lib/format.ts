/**
 * Shared display formatting.
 *
 * Currency lives here rather than in each screen because bills, inventory and
 * the dashboard must all show the same figure the same way — a total that reads
 * differently on screen than on the printed bill is a support call.
 */

/**
 * Indian digit grouping — 1,23,456.78 rather than 123,456.78 (Frontend Spec 4).
 */
export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Same grouping, but without forcing paise on whole amounts. */
export function formatQuantity(value: number): string {
  return value.toLocaleString('en-IN');
}

/** Short date for list rows, e.g. 15/08/2026. */
export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * When a bill was raised, in the terms someone actually identifies it by.
 *
 * Today and yesterday carry a time, because that is how a recent bill gets
 * recognised — "the one just before lunch". Anything older is a plain date; the
 * hour stops being how anyone remembers it.
 *
 * Compared on the local calendar day, not on elapsed hours: a bill from 11pm
 * last night is "Yesterday" at 1am, not "2 hours ago".
 *
 * `now` is injectable so the boundaries can be tested without waiting for
 * midnight.
 */
export function formatBillWhen(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';

  const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  if (isSameLocalDay(date, now)) return `Today, ${time}`;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return `Yesterday, ${time}`;

  return formatDate(date);
}
