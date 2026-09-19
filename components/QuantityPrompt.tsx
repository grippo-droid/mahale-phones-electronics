import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { formatRupees } from '@/lib/format';
import type { Product } from '@/db/products';

/**
 * "How many?" for a product just added to Inventory mid-bill (T9.4).
 *
 * Deliberately NOT how an ordinary add behaves. Tapping an existing product in
 * the search results lands it at one and the owner adjusts with the stepper,
 * which is right when the product is already on screen with its line visible.
 * This path is different: the owner has just come back from filling a whole
 * form on another screen, the cart is not what they were last looking at, and
 * landing a silent qty of 1 among the other lines is easy to miss. Asking once,
 * here, is the trade — an inconsistency taken on purpose rather than by
 * accident.
 *
 * A Modal and not `Alert.prompt`: that is iOS-only and does nothing at all on
 * Android, so it would have shipped as a prompt that never appeared. The same
 * trap the reset confirmation avoids.
 */

const DEFAULT_QTY = '1';

export default function QuantityPrompt({
  product,
  target,
  onCancel,
  onConfirm,
}: {
  /** Null closes it. */
  product: Product | null;
  /** Names what it is being added to, so the button is not wrong on one screen. */
  target: 'bill' | 'quotation';
  onCancel: () => void;
  onConfirm: (product: Product, qty: number) => void;
}) {
  const [text, setText] = useState(DEFAULT_QTY);
  const [error, setError] = useState<string | null>(null);

  /**
   * Start fresh for each product rather than keeping the last answer.
   *
   * Adjusted during render, not in an effect: an effect would paint the
   * previous product's quantity for a frame as the prompt opens, and that
   * frame is the one the owner is looking straight at. React re-runs this
   * component before committing, so the stale number never appears.
   */
  const [seenProduct, setSeenProduct] = useState(product);
  if (seenProduct !== product) {
    setSeenProduct(product);
    setText(DEFAULT_QTY);
    setError(null);
  }

  if (!product) return null;

  const confirm = () => {
    const qty = Number.parseInt(text.trim(), 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Enter a whole number above zero.');
      return;
    }
    onConfirm(product, qty);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>How many?</Text>
          <Text style={styles.product} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={styles.meta}>
            {formatRupees(product.unit_price)}
            {product.priceIncludesGst
              ? ` incl. ${product.gst_rate}% GST`
              : ` + ${product.gst_rate}% GST`}
          </Text>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(value) => {
              setText(value);
              setError(null);
            }}
            keyboardType="number-pad"
            selectTextOnFocus
            autoFocus
            maxLength={5}
            accessibilityLabel={`Quantity of ${product.name}`}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
            onPress={confirm}
            accessibilityRole="button">
            <Text style={styles.primaryText}>
              {target === 'bill' ? 'Add to the bill' : 'Add to the quotation'}
            </Text>
          </Pressable>

          {/* The product is already saved in Inventory either way. This only
              declines to put it on this bill, and says so. */}
          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            onPress={onCancel}
            accessibilityRole="button">
            <Text style={styles.secondaryText}>Not now — it is saved in Inventory</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  card: {
    width: '100%',
    gap: Spacing.xs,
    padding: Spacing.lg,
    borderRadius: 12,
    backgroundColor: Colors.background,
  },
  title: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  product: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  meta: { fontSize: FontSizes.small, color: Colors.textMuted, marginBottom: Spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    fontSize: FontSizes.title,
    color: Colors.text,
    textAlign: 'center',
  },
  error: { fontSize: FontSizes.small, color: Colors.outOfStock },
  primary: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderRadius: 10,
    backgroundColor: Colors.brand,
  },
  primaryPressed: { backgroundColor: Colors.brandDark },
  primaryText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: Spacing.minTapTarget,
    borderRadius: 10,
  },
  secondaryPressed: { backgroundColor: Colors.surface },
  secondaryText: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.textMuted },
});
