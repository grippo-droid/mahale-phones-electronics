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
