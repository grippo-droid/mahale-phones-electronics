import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import LowStockBadge, { STOCK_STATUS_COLOURS } from '@/components/LowStockBadge';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import type { Product } from '@/db/products';
import { formatQuantity, formatRupees } from '@/lib/format';

/**
 * One row in the Inventory list (T2.1) — name, category tag, stock quantity
 * highlighted by state, and price (Frontend Spec 2.2).
 *
 * Memoised because the Inventory list is expected to hold thousands of products
 * (PRD Section 9) and re-renders on every keystroke while searching.
 */

type Props = {
  product: Product;
  onPress?: (product: Product) => void;
};

function ProductCard({ product, onPress }: Props) {
  const statusColour = STOCK_STATUS_COLOURS[product.stockStatus];

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress?.(product)}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatQuantity(product.stock_qty)} in stock, ${formatRupees(product.unit_price)}`}>
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.categoryTag}>
            <Text style={styles.categoryText}>{product.category}</Text>
          </View>
          {product.brand ? <Text style={styles.brand}>{product.brand}</Text> : null}
        </View>

        <View style={styles.badgeRow}>
          <LowStockBadge status={product.stockStatus} stockQty={product.stock_qty} />
          {/* HSN is optional to save but required on a GST invoice, so the gap is
              surfaced here and again at bill generation (T4.2). */}
          {!product.hsn_code ? (
            <View style={styles.hsnWarning}>
              <Ionicons name="warning" size={11} color={Colors.lowStock} />
              <Text style={styles.hsnWarningText}>No HSN</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.side}>
        <Text style={styles.price}>{formatRupees(product.unit_price)}</Text>
        <Text style={[styles.stock, { color: statusColour }]}>
          {formatQuantity(product.stock_qty)} in stock
        </Text>
        <Text style={styles.gst}>GST {product.gst_rate}%</Text>
      </View>
    </Pressable>
  );
}

export default memo(ProductCard);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surface },
  main: { flex: 1, gap: Spacing.xs },
  name: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  categoryTag: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
  },
  categoryText: { fontSize: FontSizes.small - 2, color: Colors.textMuted, fontWeight: '600' },
  brand: { fontSize: FontSizes.small - 1, color: Colors.textMuted },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  hsnWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.lowStock,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
  },
  hsnWarningText: { fontSize: FontSizes.small - 3, color: Colors.lowStock, fontWeight: '700' },
  side: { alignItems: 'flex-end', gap: 2 },
  price: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  stock: { fontSize: FontSizes.small, fontWeight: '700' },
  gst: { fontSize: FontSizes.small - 2, color: Colors.textMuted },
});
