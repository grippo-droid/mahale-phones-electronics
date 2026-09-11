import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { listPaymentsForBills, settleRemaining, type BillPayment } from '@/db/payments';
import { deleteBillPdf } from '@/lib/pdf';
import { paymentTotalsFor, tagTapAction, type PaidState } from '@/lib/payment';

/**
 * The payment ledgers behind a list of bills, and what tapping a status tag does.
 *
 * Shared by History and the Dashboard rather than written twice. Both draw the
 * same tag on every row and both offer the same one-tap shortcut, and two
 * copies of that would drift exactly the way the category chips did before
 * `CategoryChips` existed.
 *
 * Ledgers are fetched for the whole visible page in one query. One query per
 * row would put the page size into the query count.
 */
export function useBillPayments() {
  const [ledgers, setLedgers] = useState<Map<number, BillPayment[]>>(new Map());
  const [settling, setSettling] = useState<Set<number>>(new Set());

  /** Call with the rows now on screen. Replaces what is held, rather than merging. */
  const loadFor = useCallback(async (billIds: number[]) => {
    try {
      setLedgers(await listPaymentsForBills(billIds));
    } catch {
      // A tag that cannot be drawn is not a reason to fail the list. Rows
      // render without a status rather than not at all.
      setLedgers(new Map());
    }
  }, []);

  const stateFor = useCallback(
    (billId: number, grandTotal: number): PaidState =>
      paymentTotalsFor(grandTotal, (ledgers.get(billId) ?? []).map((p) => p.amount)).state,
    [ledgers]
  );

  const outstandingFor = useCallback(
    (billId: number, grandTotal: number): number =>
      paymentTotalsFor(grandTotal, (ledgers.get(billId) ?? []).map((p) => p.amount)).outstanding,
    [ledgers]
  );

  /**
   * The tag was tapped.
   *
   * On a settled bill this opens it, so the owner can see what was received.
   * Otherwise it records one entry for whatever is still owed.
   *
   * The screen changes first and the write follows, because waiting for SQLite
   * would put a visible lag on a tap that should feel like a switch. A failure
   * puts the old ledger back and says which bill did not change — money is
   * exactly the wrong thing to be optimistic about and quiet.
   */
  const tapTag = useCallback(
    async (
      bill: { id: number; invoice_number: string; grand_total: number },
      onError: (message: string) => void
    ) => {
      const current = ledgers.get(bill.id) ?? [];
      const { state, outstanding } = paymentTotalsFor(
        bill.grand_total,
        current.map((p) => p.amount)
      );

      if (tagTapAction(state) === 'open') {
        router.push({ pathname: '/bill/[id]', params: { id: String(bill.id) } });
        return;
      }

      setSettling((busy) => new Set(busy).add(bill.id));
      // A stand-in row so the tag flips at once. Replaced by the real one below.
      const optimistic: BillPayment = {
        id: -1,
        bill_id: bill.id,
        amount: outstanding,
        paid_on: new Date().toISOString().slice(0, 10),
        note: null,
        created_at: new Date().toISOString(),
        edited_at: null,
      };
      setLedgers((all) => new Map(all).set(bill.id, [optimistic, ...current]));

      try {
        const write = await settleRemaining(bill.id);
        // The ledger changed, so any stored PDF now shows the wrong payments
        // under the same invoice number. The repository cleared the path; the
        // file is the caller's to remove.
        if (write?.staleInvoiceNumber) deleteBillPdf(write.staleInvoiceNumber);

        const refreshed = await listPaymentsForBills([bill.id]);
        setLedgers((all) => new Map(all).set(bill.id, refreshed.get(bill.id) ?? []));
      } catch (err) {
        setLedgers((all) => new Map(all).set(bill.id, current));
        onError(
          `${bill.invoice_number} could not be updated, so it is unchanged. ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } finally {
        setSettling((busy) => {
          const remaining = new Set(busy);
          remaining.delete(bill.id);
          return remaining;
        });
      }
    },
    [ledgers]
  );

  return { ledgers, loadFor, stateFor, outstandingFor, tapTag, settling };
}
