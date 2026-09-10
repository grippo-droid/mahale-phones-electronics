import { StyleSheet, Text, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { quotationAgeInDays, QUOTATION_STALE_DAYS } from '@/db/quotations';
import type { QuotationRow } from '@/db/schema';

/**
 * What state a quotation is in, on the list (T5.7).
 *
 * The same filled pill as `LowStockBadge` and `PaymentTags`, so a coloured pill
 * keeps meaning the same kind of thing everywhere.
 *
 * Three states, and the colours are chosen against the existing vocabulary:
 *
 *   - **Converted** — green, the same green as Paid and In stock. It is the
 *     good outcome and needs no action.
 *   - **20 days old** — amber, the same amber as Low stock and Not Paid: worth
 *     attention, not a fault. A quotation ageing is ordinary.
 *   - Anything newer shows nothing at all. A list where every row carries a
 *     badge is a list where no badge is noticed.
 *
 * Red is deliberately unused. Nothing here is wrong — a quotation nobody
 * accepted is a normal outcome, and colouring it like oversold stock would
 * teach the owner to ignore the colour that means something is broken.
 */

type Props = {
  quotation: Pick<QuotationRow, 'date' | 'converted_bill_id'>;
  /** Injectable so the age boundary is testable without waiting 20 days. */
  now?: Date;
};

export default function QuotationStatusBadge({ quotation, now = new Date() }: Props) {
  if (quotation.converted_bill_id !== null) {
    return (
      <View
        style={[styles.badge, { backgroundColor: Colors.inStock }]}
        accessibilityLabel="Converted into a bill">
        <Text style={styles.text}>Converted</Text>
      </View>
    );
  }

  const age = quotationAgeInDays(quotation.date, now);
  if (age < QUOTATION_STALE_DAYS) return null;

  return (
    <View
      style={[styles.badge, { backgroundColor: Colors.lowStock }]}
      accessibilityLabel={`${age} days old. The prices on this quotation may have changed.`}>
      <Text style={styles.text}>{age} days old — prices may have changed</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
    alignSelf: 'flex-start',
  },
  text: { color: '#FFFFFF', fontSize: FontSizes.small - 2, fontWeight: '700' },
});
