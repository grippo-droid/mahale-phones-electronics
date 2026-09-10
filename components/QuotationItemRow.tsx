import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { formatRupees } from '@/lib/format';
import { calculateLine } from '@/lib/gst';
import { BILL_UNITS, type BillUnit } from '@/lib/units';
import type { QuotationLine } from '@/store/quotation';

/**
 * One line on a quotation (T5.7).
 *
 * `BillItemRow` with the stock machinery taken out, rather than `BillItemRow`
 * with a flag added. Everything that row does beyond the quantity stepper is
 * about stock — live counts, oversell warnings, the deleted-product notice —
 * and none of it applies here: a quotation moves nothing and promises nothing
 * about availability. Passing `showStock={false}` through all of it would leave
 * the shop's most important screen carrying branches that only the quotation
 * screen exercises.
 *
 * The line total is computed as an inter-state supply, matching the quotation's
 * own totals: one GST figure, exact, no half-rate rounding. See
 * `lib/quotationDraft.ts`.
 */

type Props = {
  line: QuotationLine;
  onChangeQty: (productId: number, qty: number) => void;
  onStep: (productId: number, delta: number) => void;
  onChangeUnit: (productId: number, unit: BillUnit | null) => void;
  onRemove: (productId: number) => void;
};

function QuotationItemRow({ line, onChangeQty, onStep, onChangeUnit, onRemove }: Props) {
  // Held as text while editing so the field can be briefly empty mid-typing;
  // only valid whole numbers reach the store.
  const [qtyText, setQtyText] = useState(String(line.qty));

  // Adjusted during render rather than in an effect. The stepper changes
  // `line.qty` from outside this component and the text has to follow, but
  // doing that in an effect renders once with the stale text first — which is
  // React's documented case for exactly this pattern.
  const [lastQty, setLastQty] = useState(line.qty);
  if (line.qty !== lastQty) {
    setLastQty(line.qty);
    setQtyText(String(line.qty));
  }

  const totals = calculateLine(
    {
      unitPrice: line.unitPrice,
      qty: line.qty,
      gstRate: line.gstRate,
      priceIncludesGst: line.priceIncludesGst,
    },
    'inter-state'
  );

  const commitQty = (text: string) => {
    setQtyText(text);
    const parsed = Number.parseInt(text, 10);
    if (Number.isInteger(parsed) && parsed > 0) onChangeQty(line.productId, parsed);
  };

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
          accessibilityLabel={`Remove ${line.name} from the quotation`}>
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
            onBlur={() => setQtyText(String(line.qty))}
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

      <View style={styles.units}>
        {BILL_UNITS.map((unit) => {
          const selected = line.unit === unit;
          return (
            <Pressable
              key={unit}
              onPress={() => onChangeUnit(line.productId, selected ? null : unit)}
              style={({ pressed }) => [
                styles.unitChip,
                selected && styles.unitChipSelected,
                pressed && styles.unitChipPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={
                selected ? `${unit}, selected. Tap to clear.` : `Measure ${line.name} in ${unit}`
              }>
              <Text style={[styles.unitText, selected && styles.unitTextSelected]}>{unit}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default memo(QuotationItemRow);

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
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  unitChip: {
    minHeight: Spacing.minTapTarget - Spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  unitChipSelected: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  unitChipPressed: { backgroundColor: Colors.surface },
  unitText: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.textMuted },
  unitTextSelected: { color: Colors.background },
});
