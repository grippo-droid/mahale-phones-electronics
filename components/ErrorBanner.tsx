import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';

/**
 * A screen-level failure, said the same way everywhere (T7.4).
 *
 * Eight places showed one of these and they had grown four treatments between
 * them: a tinted box with an icon on the Dashboard and History, an icon with
 * no box on Quotations, and a bare line of red text on Inventory, Billing,
 * Settings and both quotation screens. A line of red text on a white screen
 * does not read as a message — it reads as something having gone wrong with
 * the layout — and nothing told the owner that all four were the same kind of
 * thing.
 *
 * This is the tinted version, because it is the one that survives being
 * glanced at. It is deliberately NOT the shape of `Toast`: a banner stays
 * until the condition clears and sits in the layout, where a toast is
 * transient and floats above it. A failure that needs acting on must not be
 * something that disappears on its own.
 *
 * Renders nothing for a null message, so a caller passes its error state
 * straight in instead of repeating the conditional at every site.
 */
export default function ErrorBanner({
  message,
  style,
}: {
  message: string | null;
  /** Margins belong to the screen — some sit in a padded scroll view, some do not. */
  style?: StyleProp<ViewStyle>;
}) {
  if (!message) return null;

  return (
    <View style={[styles.banner, style]} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={18} color={Colors.outOfStock} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    // Not centred: these messages can run to two or three lines, and a centred
    // icon then floats in the middle of the text it is marking.
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 8,
    backgroundColor: Colors.outOfStockTint,
  },
  text: { flex: 1, fontSize: FontSizes.small, color: Colors.outOfStock },
});
