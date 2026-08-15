import { StyleSheet, Text, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import type { StockStatus } from '@/db/products';

/**
 * Stock state indicator (T2.2).
 *
 * Four states, not three. `negative` is deliberately distinct from `out`:
 * zero stock is a normal thing to restock, whereas negative stock means more
 * units were billed than the app believed existed, so the recorded count is
 * wrong and needs a physical recount. Showing them identically would hide a
 * data problem behind an ordinary one.
 */

export const STOCK_STATUS_COLOURS: Record<StockStatus, string> = {
  negative: Colors.outOfStock,
  out: Colors.outOfStock,
  low: Colors.lowStock,
  ok: Colors.inStock,
};

type Props = {
  status: StockStatus;
  stockQty: number;
  /** Hide the badge entirely when stock is healthy, to keep lists quiet. */
  hideWhenOk?: boolean;
};

export default function LowStockBadge({ status, stockQty, hideWhenOk = true }: Props) {
  if (status === 'ok' && hideWhenOk) return null;

  return (
    <View
      style={[styles.badge, { backgroundColor: STOCK_STATUS_COLOURS[status] }]}
      accessibilityLabel={accessibilityLabelFor(status, stockQty)}>
      <Text style={styles.text}>{labelFor(status, stockQty)}</Text>
    </View>
  );
}

function labelFor(status: StockStatus, stockQty: number): string {
  switch (status) {
    case 'negative':
      return `Oversold ${stockQty}`;
    case 'out':
      return 'Out of stock';
    case 'low':
      return 'Low stock';
    default:
      return 'In stock';
  }
}

function accessibilityLabelFor(status: StockStatus, stockQty: number): string {
  switch (status) {
    case 'negative':
      return `Oversold. Recorded stock is ${stockQty}, which needs a recount.`;
    case 'out':
      return 'Out of stock.';
    case 'low':
      return `Low stock. ${stockQty} remaining.`;
    default:
      return `In stock. ${stockQty} available.`;
  }
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
    alignSelf: 'flex-start',
  },
  text: {
    color: '#FFFFFF',
    fontSize: FontSizes.small - 2,
    fontWeight: '700',
  },
});
