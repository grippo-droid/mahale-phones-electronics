import { Alert } from 'react-native';
import { router } from 'expo-router';

import { deleteQuotation, getQuotationById, type QuotationWithItems } from '@/db/quotations';
import { isBillUnit } from '@/lib/units';
import { useQuotationStore, type QuotationLine } from '@/store/quotation';

/**
 * Editing and deleting a quotation (T5.9), shared by its screen and its list.
 *
 * The mirror of `lib/billActions.ts`, and deliberately so — one pattern for
 * "change or remove a document", reached from two places each. The differences
 * are in what the operations mean, not in how they are offered:
 *
 *   - No stock question on delete. A quotation never moved any.
 *   - No warning about a converted quotation being edited or deleted, beyond
 *     the note on its own screen. The bill is a separate document from the
 *     moment it exists.
 */

/** Rebuilds store lines from a saved quotation, so it can be edited. */
export function quotationToStoreLines(quotation: QuotationWithItems): QuotationLine[] {
  return quotation.items.map((item) => ({
    // Keyed by product id like the cart; a deleted product gets a negative
    // stand-in, unique per line and never a real id.
    productId: item.product_id ?? -(item.id + 1),
    name: item.product_name_snapshot,
    hsnCode: item.hsn_code_snapshot,
    unitPrice: item.unit_price_snapshot,
    gstRate: item.gst_rate_snapshot,
    priceIncludesGst: item.price_includes_gst === 1,
    qty: item.qty,
    unit: isBillUnit(item.unit) ? item.unit : null,
  }));
}

/**
 * Loads a quotation into the quotation store and opens the editor.
 *
 * A converted quotation is editable like any other. What it became is shown on
 * its own screen, so the owner knows the bill will not follow the change.
 */
export async function startEditingQuotation(quotationId: number): Promise<void> {
  const quotation = await getQuotationById(quotationId);
  if (!quotation) throw new Error('That quotation could not be found.');

  useQuotationStore.getState().loadForEdit(
    quotationToStoreLines(quotation),
    {
      name: quotation.customer_name,
      phone: quotation.customer_phone,
      address: quotation.customer_address ?? '',
    },
    quotation.id
  );

  router.push('/quotation/new');
}

/**
 * Asks before deleting, and says what will and will not happen.
 *
 * Two buttons, not three: unlike a bill there is no stock question, because a
 * quotation never moved any. Where a bill's delete had to ask something, this
 * one only has to confirm.
 */
export function confirmDeleteQuotation(
  quotation: { id: number; reference_number: string; converted_bill_id: number | null },
  onDeleted: () => void,
  onError: (message: string) => void
): void {
  const remove = async () => {
    try {
      await deleteQuotation(quotation.id);
      onDeleted();
    } catch (err) {
      onError(
        err instanceof Error
          ? `${quotation.reference_number} could not be deleted: ${err.message}`
          : `${quotation.reference_number} could not be deleted.`
      );
    }
  };

  const converted = quotation.converted_bill_id !== null;

  Alert.alert(
    `Delete ${quotation.reference_number}?`,
    (converted
      ? 'This quotation has already become a bill. Deleting it here does not touch that bill — the sale stands.\n\n'
      : '') +
      'Nothing happens to stock, because a quotation never changes it. If this was the ' +
      'most recent quotation, its number becomes available again.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: remove },
    ]
  );
}
