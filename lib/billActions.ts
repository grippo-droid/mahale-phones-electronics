import { Alert } from 'react-native';
import { router } from 'expo-router';

import { deleteBill, getBillById, type BillWithItems } from '@/db/bills';
import { isPaymentType } from '@/lib/payment';
import { isBillUnit } from '@/lib/units';
import { useCartStore, type CartLine } from '@/store/cart';

/**
 * Editing and deleting a bill (T5.8), shared by the bill screen and History.
 *
 * One definition rather than two, for the reason the restore/undo pair was kept
 * to one flow: the rarer entry point would otherwise be the less tested, and
 * these are the two operations that change a finished bill.
 */

/** Rebuilds cart lines from a saved bill, so it can be edited like any cart. */
export function billToCartLines(bill: BillWithItems): CartLine[] {
  return bill.items.map((item) => ({
    // The cart keys by product id. A line whose product was deleted has none,
    // so it gets a negative stand-in — unique per line, never a real id, and
    // mapped back to NULL by `buildNewBill` before it reaches the database.
    productId: item.product_id ?? -(item.id + 1),
    name: item.product_name_snapshot,
    hsnCode: item.hsn_code_snapshot,
    // The rate the customer was charged, worked back out of what was stored.
    // `price_includes_gst` is not on a bill line — it does not need to be, since
    // the taxable value and the tax were both saved — so the line is rebuilt as
    // a pre-tax price with GST added, which reproduces the same figures.
    unitPrice: item.qty > 0 ? item.taxable_value / item.qty : item.unit_price_snapshot,
    gstRate: item.gst_rate_snapshot,
    priceIncludesGst: false,
    qty: item.qty,
    unit: isBillUnit(item.unit) ? item.unit : null,
  }));
}

/**
 * Loads a bill into the billing cart and goes there.
 *
 * The bill is not written here. It is edited on the Billing screen through the
 * same path that raises every other bill, so the customer step, the oversell
 * confirmation and the totals all behave identically — see the note on the
 * three ways into `writeBill`.
 */
export async function startEditingBill(billId: number): Promise<void> {
  const bill = await getBillById(billId);
  if (!bill) throw new Error('That bill could not be found.');
  if (bill.deleted_at !== null) throw new Error('That bill has been deleted.');

  useCartStore.getState().loadForEdit(
    billToCartLines(bill),
    {
      name: bill.customer_name,
      phone: bill.customer_phone,
      address: bill.customer_address ?? '',
      gstin: bill.customer_gstin ?? '',
      state: bill.customer_state,
    },
    {
      id: bill.id,
      grandTotal: bill.grand_total,
      paymentType: isPaymentType(bill.payment_type) ? bill.payment_type : null,
      paid: bill.paid === 1,
    }
  );

  router.push('/(tabs)/billing');
}

/**
 * Asks whether to delete, and whether the stock should come back.
 *
 * Three buttons rather than a confirm-then-ask pair, because the stock question
 * IS the confirmation — there is no way to answer it by accident, and no
 * default to be wrong about. Both answers are ordinary: a bill entered by
 * mistake never left the shelf and its stock should return; a bill deleted
 * because the goods went out unbilled should put nothing back.
 *
 * `onDeleted` runs only after the write succeeds.
 */
export function confirmDeleteBill(
  bill: { id: number; invoice_number: string },
  onDeleted: () => void,
  onError: (message: string) => void
): void {
  const remove = async (restoreStock: boolean) => {
    try {
      await deleteBill(bill.id, { restoreStock });
      onDeleted();
    } catch (err) {
      onError(
        err instanceof Error
          ? `${bill.invoice_number} could not be deleted: ${err.message}`
          : `${bill.invoice_number} could not be deleted.`
      );
    }
  };

  Alert.alert(
    `Delete ${bill.invoice_number}?`,
    'It will be removed from History and from the totals. The invoice number stays ' +
      'used, so it is never given to another customer.\n\n' +
      'Should the items on this bill go back into stock?',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete, keep stock as is', style: 'destructive', onPress: () => remove(false) },
      { text: 'Delete and put stock back', style: 'destructive', onPress: () => remove(true) },
    ]
  );
}
