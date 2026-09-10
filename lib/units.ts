/**
 * The unit a bill line is measured in (Meter, Box, Pieces, Feet).
 *
 * Per bill line, not per product. The same cable is sold by the meter to one
 * customer and by the box to another, so the unit belongs to the sale rather
 * than to the catalogue entry.
 *
 * A fixed list for the same reason categories are fixed (`lib/categories.ts`):
 * free text lets "pcs", "Pcs" and "pieces" become three units on one shop's
 * bills, and a GST invoice is the wrong place to discover that.
 */

/** What is stored in `bill_items.unit`. NULL means no unit was chosen. */
export type BillUnit = 'Meter' | 'Box' | 'Pieces' | 'Feet';

/** The four options, in the order the selector shows them. */
export const BILL_UNITS: readonly BillUnit[] = ['Meter', 'Box', 'Pieces', 'Feet'] as const;

/**
 * How a unit prints beside a quantity — "5 Mtr", "2 Box", "10 Pcs", "3 Feet".
 *
 * The short form is what goes on the invoice, where the quantity column is
 * narrow and a customer reads it at a glance. The long form stays in the
 * database and in the selector, because "Pieces" is unambiguous on screen where
 * there is room for it.
 */
const SHORT_FORM: Record<BillUnit, string> = {
  Meter: 'Mtr',
  Box: 'Box',
  Pieces: 'Pcs',
  Feet: 'Feet',
};

/** True for one of the four units. Anything else — including NULL — is not. */
export function isBillUnit(value: unknown): value is BillUnit {
  return typeof value === 'string' && (BILL_UNITS as readonly string[]).includes(value);
}

/**
 * A quantity with its unit, or the bare quantity when there is none.
 *
 * Bills raised before this field existed have no unit, and neither do lines
 * where the owner did not pick one. Both print as they always did — just the
 * number. Nothing is guessed or backfilled: a unit that was never chosen is not
 * a fact about the sale, and inventing one puts a claim on a customer's invoice
 * that nobody made.
 *
 * An unrecognised value is treated as no unit rather than printed through. The
 * column is plain TEXT, so a hand-edited database or a backup from a future
 * build can hold anything, and an invoice is not where that should surface.
 */
export function formatQuantity(qty: number, unit: string | null | undefined): string {
  return isBillUnit(unit) ? `${qty} ${SHORT_FORM[unit]}` : String(qty);
}
