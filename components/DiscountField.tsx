import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { formatRupees } from '@/lib/format';
import { discountAmountFor, isDiscountClamped, type LineDiscount } from '@/lib/gst';

/**
 * The discount on one bill or quotation line (T9.6).
 *
 * Collapsed to a single "Add discount" link until one is wanted, because most
 * lines have none and a permanently open pair of fields on every row would
 * bury the quantity stepper — which is the control actually used on every sale.
 *
 * Percentage or flat rupees, chosen per line. Two chips rather than a dropdown:
 * there are exactly two, and a dropdown to pick between two is a tap and a
 * wait for no information.
 *
 * What it shows underneath is the MONEY. "20%" is the agreement, but the figure
 * that matters at a counter is what came off, and on a line of several units a
 * percentage is not something anyone should be asked to do in their head.
 */

type Props = {
  discount: LineDiscount | null;
  /** The line before any discount, used to show what a percentage comes to. */
  lineGross: number;
  onChange: (discount: LineDiscount | null) => void;
};

export default function DiscountField({ discount, lineGross, onChange }: Props) {
  const [open, setOpen] = useState(discount !== null);
  const [text, setText] = useState(discount ? String(discount.value) : '');

  const type = discount?.type ?? 'percent';
  const taken = discountAmountFor(lineGross, discount);
  const clamped = isDiscountClamped(lineGross, discount);

  const apply = (nextType: LineDiscount['type'], raw: string) => {
    setText(raw);
    const value = Number.parseFloat(raw);
    // An empty or unreadable box is not a discount of zero — it is no discount,
    // which is what clearing it should mean.
    onChange(Number.isFinite(value) && value > 0 ? { type: nextType, value } : null);
  };

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={Spacing.sm}
        style={styles.addLink}
        accessibilityRole="button"
        accessibilityLabel="Add a discount to this line">
        <Ionicons name="pricetag-outline" size={14} color={Colors.brand} />
        <Text style={styles.addLinkText}>Add discount</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {(['percent', 'amount'] as const).map((option) => {
          const selected = type === option;
          return (
            <Pressable
              key={option}
              onPress={() => apply(option, text)}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && styles.chipPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option === 'percent' ? 'Discount by percentage' : 'Discount by rupees'}>
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {option === 'percent' ? '%' : '₹'}
              </Text>
            </Pressable>
          );
        })}

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(raw) => apply(type, raw)}
          keyboardType="decimal-pad"
          placeholder={type === 'percent' ? '0%' : '₹0'}
          placeholderTextColor={Colors.textMuted}
          maxLength={8}
          accessibilityLabel="Discount amount"
        />

        <Pressable
          onPress={() => {
            setOpen(false);
            setText('');
            onChange(null);
          }}
          hitSlop={Spacing.sm}
          style={styles.clear}
          accessibilityRole="button"
          accessibilityLabel="Remove the discount from this line">
          <Ionicons name="close" size={16} color={Colors.textMuted} />
        </Pressable>
      </View>

      {taken > 0 ? (
        <Text style={styles.taken}>
          {formatRupees(taken)} off
          {clamped ? ' — the whole line, which is all it was worth' : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  addLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.xs,
  },
  addLinkText: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.brand },

  wrap: { gap: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  chip: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipSelected: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  chipPressed: { opacity: 0.7 },
  chipText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.textMuted },
  chipTextSelected: { color: '#FFFFFF' },
  input: {
    flex: 1,
    minHeight: 36,
    paddingHorizontal: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: FontSizes.body,
    color: Colors.text,
  },
  clear: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Amber, not green: money coming off is worth noticing, and green here would
  // read as a state being correct rather than as a figure to check.
  taken: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.lowStock },
});
