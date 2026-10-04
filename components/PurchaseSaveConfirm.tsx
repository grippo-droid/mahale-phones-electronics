import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { formatRupees } from '@/lib/format';
import { formatQuantityWithUnit } from '@/lib/units';

/**
 * What saving a purchase should do beyond recording it (T10.3).
 *
 * ---------------------------------------------------------------------------
 * Two questions, deliberately separate, because they are separate facts: how
 * many are on the shelf, and what the shop pays for them. An owner may well
 * want one without the other — goods invoiced but not yet delivered, or a
 * delivery at an unusual rate that should not become the standing cost.
 *
 * **Stock is pre-ticked.** Recording a purchase nearly always means goods
 * arrived, so the common answer is the one already selected and the owner taps
 * once. That is still asking — it is a confirmation, not an automatic write —
 * and it is unlike the bill-delete question, which has no default because both
 * of ITS answers are genuinely common.
 *
 * **Cost price is unticked, per line.** `products.purchase_price` is what the
 * owner judges a selling price against. One delivery silently rewriting it
 * would move every margin that reads it, so it is opted into deliberately and
 * one product at a time.
 *
 * A `Modal` rather than an `Alert`: Android's `Alert` has no checkboxes at all,
 * so this is not a style choice. It is also why the reset confirmation is a
 * modal — `Alert.prompt` is iOS-only and would have shipped doing nothing.
 * ---------------------------------------------------------------------------
 */

export type ConfirmLine = {
  /** NULL for a one-off line with nothing in Inventory behind it. */
  productId: number | null;
  name: string;
  qty: number;
  unit: string | null;
  costPrice: number;
};

type Props = {
  visible: boolean;
  lines: ConfirmLine[];
  total: number;
  saving?: boolean;
  onCancel: () => void;
  onConfirm: (choice: { applyStock: boolean; updateCostFor: number[] }) => void;
};

export default function PurchaseSaveConfirm({
  visible,
  lines,
  total,
  saving = false,
  onCancel,
  onConfirm,
}: Props) {
  const [applyStock, setApplyStock] = useState(true);
  const [costFor, setCostFor] = useState<number[]>([]);

  /**
   * Reset when the modal is opened again, adjusted during render rather than
   * in an effect — the T7.4 pattern. React re-runs the component before
   * committing, so the stale answers are never painted.
   */
  const [lastVisible, setLastVisible] = useState(visible);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) {
      setApplyStock(true);
      setCostFor([]);
    }
  }

  const stocked = lines.filter((line) => line.productId !== null);

  const toggleCost = (productId: number) => {
    setCostFor((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Save this purchase?</Text>
          <Text style={styles.sub}>
            {lines.length} {lines.length === 1 ? 'item' : 'items'} · {formatRupees(total)}
          </Text>

          <Pressable
            style={styles.stockRow}
            onPress={() => setApplyStock((on) => !on)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: applyStock }}
            accessibilityLabel="Add these quantities to stock">
            <Ionicons
              name={applyStock ? 'checkbox' : 'square-outline'}
              size={24}
              color={applyStock ? Colors.brand : Colors.textMuted}
            />
            <View style={styles.stockText}>
              <Text style={styles.stockTitle}>Update stock for these items</Text>
              <Text style={styles.stockSub}>
                {applyStock
                  ? 'The quantities below will be added to what is on the shelf.'
                  : 'Stock will not change. Choose this if the goods have not arrived yet.'}
              </Text>
            </View>
          </Pressable>

          <View style={styles.divider} />

          <Text style={styles.listHeading}>
            {stocked.length > 0
              ? 'Also update what you pay for these?'
              : 'Nothing on this purchase is in Inventory'}
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {lines.map((line, index) => {
              // A free-text line is SHOWN rather than hidden, greyed with a
              // note. Hiding it would make the count above disagree with the
              // purchase the owner is looking at.
              if (line.productId === null) {
                return (
                  <View key={`loose-${index}`} style={styles.lineRow}>
                    <View style={styles.lineText}>
                      <Text style={styles.lineNameMuted} numberOfLines={1}>
                        {line.name}
                      </Text>
                      <Text style={styles.lineSub}>
                        Not in Inventory — no stock or cost to update
                      </Text>
                    </View>
                  </View>
                );
              }

              const productId = line.productId;
              const checked = costFor.includes(productId);
              return (
                <Pressable
                  key={productId}
                  style={styles.lineRow}
                  onPress={() => toggleCost(productId)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={`Update the cost price of ${line.name} to ${formatRupees(line.costPrice)}`}>
                  <Ionicons
                    name={checked ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={checked ? Colors.brand : Colors.textMuted}
                  />
                  <View style={styles.lineText}>
                    <Text style={styles.lineName} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <Text style={styles.lineSub}>
                      {formatQuantityWithUnit(line.qty, line.unit)} at{' '}
                      {formatRupees(line.costPrice)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={onCancel}
              disabled={saving}
              accessibilityRole="button">
              <Text style={styles.buttonText}>Back</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.buttonPrimary,
                pressed && styles.buttonPrimaryPressed,
              ]}
              onPress={() => onConfirm({ applyStock, updateCostFor: costFor })}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save the purchase">
              <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                {saving ? 'Saving…' : 'Save purchase'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  card: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: Spacing.md,
    gap: Spacing.sm,
    maxHeight: '85%',
  },
  title: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSizes.small, color: Colors.textMuted },

  stockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    minHeight: Spacing.minTapTarget,
  },
  stockText: { flex: 1, gap: 2 },
  stockTitle: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  stockSub: { fontSize: FontSizes.small, color: Colors.textMuted },

  divider: { height: 1, backgroundColor: Colors.border },
  listHeading: { fontSize: FontSizes.small, fontWeight: '700', color: Colors.textMuted },

  list: { flexGrow: 0 },
  listContent: { gap: Spacing.xs },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    minHeight: Spacing.minTapTarget,
  },
  lineText: { flex: 1 },
  lineName: { fontSize: FontSizes.body, color: Colors.text },
  lineNameMuted: { fontSize: FontSizes.body, color: Colors.textMuted },
  lineSub: { fontSize: FontSizes.small, color: Colors.textMuted },

  buttons: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
  button: {
    minHeight: Spacing.minTapTarget,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    borderRadius: 8,
  },
  buttonPressed: { backgroundColor: Colors.surface },
  buttonPrimary: { backgroundColor: Colors.brand },
  buttonPrimaryPressed: { backgroundColor: Colors.brandDark },
  buttonText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.brand },
  buttonTextPrimary: { color: '#FFFFFF' },
});
