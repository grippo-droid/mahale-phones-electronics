import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import type { Product } from '@/db/products';
import { formatRupees } from '@/lib/format';

/**
 * One tappable product on the Billing screen — used by both the search results
 * and the frequently-sold list (T3.8).
 *
 * Shared so the two cannot drift into looking like different actions. They are
 * the same action: tap a product, it goes on the bill.
 */

type Props = {
  product: Product;
  /** Quantity already on the bill, if any. */
  qtyInCart?: number;
  /** Units sold, shown only where a ranking is being explained. */
  unitsSold?: number;
  onAdd: (product: Product) => void;
};

function ProductPickRow({ product, qtyInCart, unitsSold, onAdd }: Props) {
  const out = product.stock_qty <= 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onAdd(product)}
      accessibilityRole="button"
      accessibilityLabel={`Add ${product.name} to the bill. ${product.stock_qty} in stock.`}>
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={[styles.stock, out && styles.stockOut]}>
          {product.stock_qty} in stock
          {/* Selling past zero is allowed; the cart line spells out the effect,
              so this states the position rather than forbidding the tap. */}
          {out ? ' — can still be billed' : ''}
          {unitsSold !== undefined ? ` · ${unitsSold} sold` : ''}
        </Text>
      </View>

      <View style={styles.side}>
        <Text style={styles.price}>{formatRupees(product.unit_price)}</Text>
        {qtyInCart ? (
          <View style={styles.inCartTag}>
            <Ionicons name="checkmark" size={12} color="#FFFFFF" />
            <Text style={styles.inCartText}>{qtyInCart} on bill</Text>
          </View>
        ) : (
          <Ionicons name="add-circle" size={26} color={Colors.brand} />
        )}
      </View>
    </Pressable>
  );
}

export default memo(ProductPickRow);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surface },
  main: { flex: 1, gap: 2 },
  name: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  stock: { fontSize: FontSizes.small, color: Colors.textMuted },
  stockOut: { color: Colors.outOfStock, fontWeight: '600' },
  side: { alignItems: 'flex-end', gap: Spacing.xs },
  price: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  inCartTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    backgroundColor: Colors.inStock,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
  },
  inCartText: { color: '#FFFFFF', fontSize: FontSizes.small - 3, fontWeight: '700' },
});
