import { PRODUCT_CATEGORIES } from '@/db/schema';

/**
 * The category filter row, shared by Inventory (T2.1) and Billing (T3.7).
 *
 * Extracted when Billing gained the same chips: two copies of this rule would
 * drift, and the rule itself is the interesting part — see below.
 */

/** The chip meaning "no category filter". Not a category; never stored. */
export const ALL_CATEGORIES = 'All';

/**
 * The fixed category list, plus any category actually present in the data that
 * is not on it.
 *
 * Adding a product only offers the fixed list. But *filtering* has to cover what
 * is really stored, or products in a retired or renamed category become
 * unreachable — invisible under every chip, including the one they belong to.
 * That happens after the category list is edited (as it was when
 * "Wiring & Electrical" was introduced) or after restoring an older backup.
 *
 * Orphans go last: they are the exception, and the fixed list is what the owner
 * expects to see first.
 */
export function buildCategoryFilters(usedCategories: string[]): string[] {
  const fixed = [...PRODUCT_CATEGORIES] as string[];
  const orphans = usedCategories.filter((category) => !fixed.includes(category));
  return [ALL_CATEGORIES, ...fixed, ...orphans];
}
