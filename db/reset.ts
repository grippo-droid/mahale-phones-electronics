import type { SQLiteDatabase } from 'expo-sqlite';

import { getDatabase } from './init';

/**
 * Clearing the shop's data without reinstalling the app.
 *
 * This exists for one specific moment: the app is handed over, tested freely
 * for a few days, and then has to be put back to a genuine first-run state
 * before the first real bill is raised. Doing that through Android's "Clear
 * storage" works, but it means the owner digging through system settings, and
 * it takes the shop's details with it.
 */

/**
 * What was removed, so the confirmation afterwards can say something true
 * rather than "done".
 */
export type ResetSummary = {
  products: number;
  bills: number;
  billItems: number;
  /** Invoice counter rows dropped — one per financial year that had bills. */
  invoiceCounters: number;
};

/**
 * Wipes products, bills and bill lines, and the invoice counters with them.
 *
 * **The counters are the part that is easy to miss, and the part that matters
 * most.** `reserveInvoiceNumber` reads `invoice_seq:<period>` from
 * `app_settings` BEFORE it falls back to the configured starting number, so a
 * reset that clears only the three tables leaves the series continuing from
 * wherever the testing got to. The next "first" bill would be
 * MPE/2026-27/0156, not 0151 — and it would look right at a glance, which is
 * exactly what makes it dangerous. Clearing bills without clearing counters is
 * not a partial reset; it is a broken one.
 *
 * The shop's own details are deliberately kept. Business name, GSTIN, address,
 * the invoice format and the low-stock default are configuration, not data —
 * losing them means retyping a GSTIN by hand, which is its own source of error.
 * Everything removed here is a row the owner created and can recreate.
 *
 * One transaction, so a failure part-way leaves the shop exactly as it was
 * rather than half-erased.
 */
export async function resetShopData(
  db: SQLiteDatabase = getDatabase()
): Promise<ResetSummary> {
  const summary: ResetSummary = { products: 0, bills: 0, billItems: 0, invoiceCounters: 0 };

  await db.withExclusiveTransactionAsync(async (txn) => {
    // Counted inside the transaction so the figures reported are the rows that
    // were actually removed, not a reading taken before something else wrote.
    const counts = await txn.getFirstAsync<{
      products: number;
      bills: number;
      bill_items: number;
      counters: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM products)   AS products,
         (SELECT COUNT(*) FROM bills)      AS bills,
         (SELECT COUNT(*) FROM bill_items) AS bill_items,
         (SELECT COUNT(*) FROM app_settings
           WHERE key LIKE 'invoice\\_seq:%' ESCAPE '\\') AS counters`
    );

    summary.products = counts?.products ?? 0;
    summary.bills = counts?.bills ?? 0;
    summary.billItems = counts?.bill_items ?? 0;
    summary.invoiceCounters = counts?.counters ?? 0;

    // bill_items first even though the cascade would handle it — being explicit
    // means this still works if the cascade is ever changed.
    await txn.execAsync(`
      DELETE FROM bill_items;
      DELETE FROM bills;
      DELETE FROM products;
    `);

    // The escape matters: an unescaped _ is a single-character wildcard, so
    // 'invoice_seq:%' would also match a future key like 'invoiceXseq:...'.
    await txn.runAsync(`DELETE FROM app_settings WHERE key LIKE 'invoice\\_seq:%' ESCAPE '\\'`);
  });

  return summary;
}
