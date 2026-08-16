import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { formatRupees } from '@/lib/format';
import { calculateLine } from '@/lib/gst';
import type { CartLine } from '@/store/cart';

/**
 * One line on the bill in progress (T3.3).
 *
 * The oversell warning is inline rather than a dialog. Billing past zero is
 * allowed by design, and a modal on every such line trains the user to dismiss
 * it without reading; an inline warning stays visible for as long as it is true,
 * including at the moment the bill is reviewed. A blocking confirmation belongs
 * where an edit is deliberate — see StockAdjuster — not where a condition is
 * merely being reported.
 */

type Props = {
  line: CartLine;
  /**
   * Live stock, read from the database rather than from the cart, or null if the
   * product has been deleted since it was added.
   */
  stockQty: number | null;
  onChangeQty: (productId: number, qty: number) => void;
  onStep: (productId: number, delta: number) => void;
  onRemove: (productId: number) => void;
};

function BillItemRow({ line, stockQty, onChangeQty, onStep, onRemove }: Props) {
  // Held as text while editing so the field can be briefly empty mid-typing;
  // only valid whole numbers reach the store.
  const [qtyText, setQtyText] = useState(String(line.qty));

  useEffect(() => {
    setQtyText(String(line.qty));
  }, [line.qty]);

  // The line total is the same figure regardless of CGST/SGST versus IGST, so it
  // can be shown before the customer's state is known (T3.4 settles the split).
  const totals = calculateLine(
    {
      unitPrice: line.unitPrice,
      qty: line.qty,
      gstRate: line.gstRate,
      priceIncludesGst: line.priceIncludesGst,
    },
    'intra-state'
  );

  const missing = stockQty === null;
  const remaining = missing ? null : stockQty - line.qty;
  const oversold = remaining !== null && remaining < 0;
  const exact = remaining === 0;

  const commitQty = (text: string) => {
    setQtyText(text);
    const parsed = Number.parseInt(text, 10);
    if (Number.isInteger(parsed) && parsed > 0) onChangeQty(line.productId, parsed);
  };

  // An empty or nonsense field reverts to the stored quantity rather than
  // guessing, so a mis-tap cannot silently change what is being billed.
  const restoreOnBlur = () => setQtyText(String(line.qty));

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <View style={styles.nameBlock}>
          <Text style={styles.name} numberOfLines={2}>
            {line.name}
          </Text>
          <Text style={styles.meta}>
            {formatRupees(line.unitPrice)}{' '}
            {line.priceIncludesGst ? `incl. ${line.gstRate}% GST` : `+ ${line.gstRate}% GST`}
          </Text>
        </View>

        <Pressable
          onPress={() => onRemove(line.productId)}
          hitSlop={Spacing.sm}
          style={styles.remove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${line.name} from the bill`}>
          <Ionicons name="close" size={20} color={Colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.controls}>
        <View style={styles.stepper}>
          <Pressable
            style={({ pressed }) => [styles.stepButton, pressed && styles.stepButtonPressed]}
            onPress={() => onStep(line.productId, -1)}
            accessibilityRole="button"
            accessibilityLabel={`Reduce quantity of ${line.name}`}>
            <Ionicons name="remove" size={22} color={Colors.brand} />
          </Pressable>

          <TextInput
            style={styles.qtyInput}
            value={qtyText}
            onChangeText={commitQty}
            onBlur={restoreOnBlur}
            keyboardType="number-pad"
            selectTextOnFocus
            maxLength={5}
            accessibilityLabel={`Quantity of ${line.name}`}
          />

          <Pressable
            style={({ pressed }) => [styles.stepButton, pressed && styles.stepButtonPressed]}
            onPress={() => onStep(line.productId, 1)}
            accessibilityRole="button"
            accessibilityLabel={`Increase quantity of ${line.name}`}>
            <Ionicons name="add" size={22} color={Colors.brand} />
          </Pressable>
        </View>

        <Text style={styles.lineTotal}>{formatRupees(totals.lineTotal)}</Text>
      </View>

      {missing ? (
        <View style={styles.warning}>
          <Ionicons name="alert-circle" size={14} color={Colors.outOfStock} />
          <Text style={styles.warningTextStrong}>
            This product has been deleted. Remove it, or the bill will have no stock to reduce.
          </Text>
        </View>
      ) : oversold ? (
        <View style={styles.warning}>
          <Ionicons name="warning" size={14} color={Colors.outOfStock} />
          <Text style={styles.warningTextStrong}>
            Only {stockQty} in stock — recorded stock will go to {remaining}.
          </Text>
        </View>
      ) : exact ? (
        <View style={styles.warning}>
          <Ionicons name="information-circle" size={14} color={Colors.lowStock} />
          <Text style={styles.warningText}>This uses the last {stockQty === 1 ? 'one' : stockQty}.</Text>
        </View>
      ) : null}
    </View>
  );
}

export default memo(BillItemRow);

const styles = StyleSheet.create({
  row: {
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  nameBlock: { flex: 1, gap: 2 },
  name: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  meta: { fontSize: FontSizes.small, color: Colors.textMuted },
  remove: {
    width: Spacing.minTapTarget - Spacing.md,
    height: Spacing.minTapTarget - Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  stepButton: {
    width: Spacing.minTapTarget,
    height: Spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonPressed: { backgroundColor: Colors.surface },
  qtyInput: {
    minWidth: 56,
    height: Spacing.minTapTarget,
    textAlign: 'center',
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.text,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
  },
  lineTotal: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  warning: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  warningText: { flex: 1, fontSize: FontSizes.small, color: Colors.lowStock },
  warningTextStrong: { flex: 1, fontSize: FontSizes.small, color: Colors.outOfStock, fontWeight: '600' },
});
