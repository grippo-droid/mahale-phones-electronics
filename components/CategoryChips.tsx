import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { ALL_CATEGORIES } from '@/lib/categories';

/**
 * The horizontal category filter row, shared by Inventory and Billing.
 *
 * T3.7 shared the rule for *which* chips to show (`lib/categories.ts`) but left
 * both screens rendering them separately. The two copies then drifted in the
 * usual way: a layout fix applied to one left the other cut off at the screen
 * edge. Rendering lives here now so there is one row to fix.
 *
 * Two layout details are load-bearing rather than cosmetic:
 *
 *   - `flexGrow: 0` on the ScrollView. A horizontal scroller inside a flex
 *     column otherwise claims vertical space it does not need, squeezing the
 *     list beneath it.
 *
 *   - A wider right padding than left. With symmetric padding the last chip
 *     sits flush against the screen edge and reads as clipped rather than as
 *     something to scroll towards.
 */

type Props = {
  chips: string[];
  selected: string;
  onSelect: (category: string) => void;
  /** Overrides the label read out for the "All" chip, which differs by screen. */
  allLabel?: string;
};

export default function CategoryChips({ chips, selected, onSelect, allLabel }: Props) {
  return (
    <ScrollView
      horizontal
      style={styles.scroll}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      {chips.map((chip) => {
        const active = selected === chip;
        return (
          <Pressable
            key={chip}
            onPress={() => onSelect(chip)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              chip === ALL_CATEGORIES ? (allLabel ?? 'Show all categories') : `Show ${chip}`
            }>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: {
    gap: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  chip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget - 8,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  chipText: { fontSize: FontSizes.small, color: Colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
});
