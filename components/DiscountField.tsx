import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { formatRupees } from '@/lib/format';
import {
  discountAmountFor,
  discountFromInput,
  isDiscountClamped,
  type LineDiscount,
} from '@/lib/gst';

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

  /**
   * Which chip is selected — REAL state, not derived from the discount.
   *
   * -------------------------------------------------------------------------
   * It used to be `discount?.type ?? 'percent'`, and that made the ₹ chip
   * unselectable until a number had been typed. Tapping it called `onChange`
   * with the box still empty, an empty box is no discount rather than a
   * discount of zero, so `onChange(null)` went to the store, `discount` came
   * back null, and the type fell to its `?? 'percent'` default. The chip
   * re-rendered as % and the tap looked ignored.
   *
   * It only ever showed on ₹ because 'percent' IS the fallback: tapping % did
   * the same round trip and landed where it started, so nothing looked wrong.
   *
   * Picking the type and giving the amount are two separate statements, and
   * the first has to survive the second being unanswered.
   * -------------------------------------------------------------------------
   */
  const [type, setType] = useState<LineDiscount['type']>(discount?.type ?? 'percent');

  /**
   * Follow the prop when it genuinely carries a type — a stored discount being
   * loaded into an edited bill — but never when it goes null.
   *
   * Adjusted during render rather than in an effect, which is the pattern T7.4
   * settled on: React re-runs the component before committing, so the stale
   * chip is never painted, where an effect shows it for a frame and replaces
   * it. Null is skipped deliberately; that is the clearing case above, and
   * following it is the bug.
   */
  const incomingType = discount?.type ?? null;
  const [lastSeenType, setLastSeenType] = useState(incomingType);
  if (incomingType !== null && incomingType !== lastSeenType) {
    setLastSeenType(incomingType);
    setType(incomingType);
  }

  const taken = discountAmountFor(lineGross, discount);
  const clamped = isDiscountClamped(lineGross, discount);

  /**
   * What the line is worth to the cart. An empty or unreadable box is not a
   * discount of zero — it is no discount, which is what clearing it means.
   * The chosen type stays local either way.
   */
  const emit = (forType: LineDiscount['type'], raw: string) => {
    onChange(discountFromInput(forType, raw));
  };

  const chooseType = (nextType: LineDiscount['type']) => {
    setType(nextType);
    emit(nextType, text);
  };

  /**
   * The typed amount is deliberately NOT synced back from the prop. A value of
   * "5." parses to 5, so echoing the stored number into the box would rewrite
   * it to "5" mid-keystroke and make a decimal impossible to type.
   */
  const onTypeAmount = (raw: string) => {
    setText(raw);
    emit(type, raw);
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
              onPress={() => chooseType(option)}
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
          onChangeText={onTypeAmount}
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
  // Real 48dp, not 36 with hitSlop. The chips sit Spacing.xs apart, so the
  // 6dp of slop each would need to reach 48 overlaps by 8dp in the middle --
  // an ambiguous strip where one chip can take the other's tap, which is the
  // same shape as the bug this change exists to fix.
  chip: {
    minWidth: Spacing.minTapTarget,
    minHeight: Spacing.minTapTarget,
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
    minHeight: Spacing.minTapTarget,
    paddingHorizontal: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: FontSizes.body,
    color: Colors.text,
  },
  // Also a real 48, and its hitSlop is dropped with the growth: 48 plus slop
  // would reach back over the amount box, so tapping the end of the field
  // could clear the discount instead of placing the cursor.
  clear: {
    minWidth: Spacing.minTapTarget,
    minHeight: Spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Amber, not green: money coming off is worth noticing, and green here would
  // read as a state being correct rather than as a figure to check.
  taken: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.lowStock },
});
