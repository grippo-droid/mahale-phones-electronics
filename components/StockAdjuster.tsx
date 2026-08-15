import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { STOCK_STATUS_COLOURS } from '@/components/LowStockBadge';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { adjustStock, setStock, type Product } from '@/db/products';
import { formatQuantity } from '@/lib/format';

/**
 * Manual stock adjustment (T2.6) — receiving new stock, or correcting a count
 * after a physical check, without raising a bill.
 *
 * Deliberately separates the two operations. "Add 10" and "set to 10" are
 * different intentions, and a single editable number cannot tell them apart:
 * typing over a figure that another action changed a moment ago silently
 * discards that change. Adds and removes are relative, so they stay correct
 * regardless of what the count was when the screen opened.
 *
 * Changes apply immediately — they are not held until the form's Save button,
 * because a half-applied stock change is worse than an unsaved one.
 */

type Props = {
  product: Product;
  onChanged: (updated: Product) => void;
};

export default function StockAdjuster({ product, onChanged }: Props) {
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState(false);

  const parsedAmount = Number(amount.trim());
  const amountValid = Number.isInteger(parsedAmount) && parsedAmount > 0;

  const apply = async (action: () => Promise<Product>) => {
    setBusy(true);
    try {
      onChanged(await action());
      setAmount('1');
    } catch (err) {
      Alert.alert('Could not update stock', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => apply(() => adjustStock(product.id, parsedAmount));

  const handleRemove = () => {
    const resulting = product.stock_qty - parsedAmount;
    if (resulting < 0) {
      // Permitted, but never silently — negative stock means the recorded count
      // no longer matches the shelf.
      Alert.alert(
        'Stock will go negative',
        `Removing ${parsedAmount} from ${formatQuantity(product.stock_qty)} leaves ${resulting}. ` +
          'This is allowed, but it means the recorded count is wrong and needs a physical check.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove anyway',
            style: 'destructive',
            onPress: () => apply(() => adjustStock(product.id, -parsedAmount)),
          },
        ]
      );
      return;
    }
    apply(() => adjustStock(product.id, -parsedAmount));
  };

  const handleSetExact = () => {
    Alert.alert(
      'Set exact count?',
      `This replaces the recorded stock of ${formatQuantity(product.stock_qty)} with ${parsedAmount}. ` +
        'Use this after physically counting the shelf.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Set count', onPress: () => apply(() => setStock(product.id, parsedAmount)) },
      ]
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Stock</Text>

      <View style={styles.currentRow}>
        <Text style={[styles.current, { color: STOCK_STATUS_COLOURS[product.stockStatus] }]}>
          {formatQuantity(product.stock_qty)}
        </Text>
        <Text style={styles.currentLabel}>
          in stock
          {product.stockStatus === 'negative' ? ' — needs a physical count' : ''}
        </Text>
      </View>

      <Text style={styles.amountLabel}>Amount</Text>
      <TextInput
        style={[styles.input, !amountValid && amount.trim() !== '' && styles.inputError]}
        value={amount}
        onChangeText={setAmount}
        keyboardType="number-pad"
        placeholder="1"
        placeholderTextColor={Colors.textMuted}
        accessibilityLabel="Amount to add or remove"
      />
      {!amountValid && amount.trim() !== '' ? (
        <Text style={styles.errorText}>Enter a whole number above zero.</Text>
      ) : null}

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.button, styles.addButton, (!amountValid || busy) && styles.disabled]}
          onPress={handleAdd}
          disabled={!amountValid || busy}
          accessibilityRole="button"
          accessibilityLabel={`Add ${amount} to stock`}>
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={styles.buttonText}>Add</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={[styles.button, styles.removeButton, (!amountValid || busy) && styles.disabled]}
          onPress={handleRemove}
          disabled={!amountValid || busy}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${amount} from stock`}>
          <Ionicons name="remove" size={20} color="#FFFFFF" />
          <Text style={styles.buttonText}>Remove</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.secondaryButton, (!amountValid || busy) && styles.disabled]}
        onPress={handleSetExact}
        disabled={!amountValid || busy}
        accessibilityRole="button">
        <Text style={styles.secondaryText}>Set exact count to {amountValid ? parsedAmount : '…'}</Text>
      </Pressable>

      <Text style={styles.hint}>
        Stock changes here save straight away — the Save button above is only for the product
        details.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: Spacing.md,
    marginTop: Spacing.lg,
    backgroundColor: Colors.surface,
  },
  heading: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  currentRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, marginTop: Spacing.sm },
  current: { fontSize: FontSizes.heading, fontWeight: '700' },
  currentLabel: { flex: 1, fontSize: FontSizes.small, color: Colors.textMuted },
  amountLabel: {
    fontSize: FontSizes.small,
    fontWeight: '700',
    color: Colors.text,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    fontSize: FontSizes.body,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  inputError: { borderColor: Colors.outOfStock },
  errorText: { fontSize: FontSizes.small, color: Colors.outOfStock, marginTop: Spacing.xs },
  buttonRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
  },
  addButton: { backgroundColor: Colors.inStock },
  removeButton: { backgroundColor: Colors.textMuted },
  buttonText: { color: '#FFFFFF', fontSize: FontSizes.body, fontWeight: '700' },
  secondaryButton: {
    marginTop: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryText: { fontSize: FontSizes.body, color: Colors.brand, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  hint: {
    marginTop: Spacing.sm,
    fontSize: FontSizes.small - 1,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
