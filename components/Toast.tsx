import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, FontSizes, Spacing, TAB_BAR_HEIGHT, TOAST_GAP } from '@/constants/theme';
import { useToastStore } from '@/store/toast';

/**
 * The confirmation banner (T7.3), mounted once above every screen.
 *
 * Three things about it are deliberate:
 *
 * **It never takes a touch.** `pointerEvents: 'none'` on the wrapper, so it can
 * sit over the Billing summary bar or the Inventory "+" button without ever
 * swallowing a tap meant for them. That also means there is nothing to dismiss
 * — it goes on its own, which is the whole point of it not being a dialog.
 *
 * **It is anchored above the tab bar, not over it.** The tabs are how the owner
 * moves around mid-sale, and covering them to say "saved" would be worse than
 * saying nothing.
 *
 * **The timer is keyed to the toast's id.** Two saves in quick succession
 * replace one another, and the first one's timer must not clear the second off
 * the screen a moment after it appears.
 */

/** Long enough to read a product name at a counter, short enough not to linger. */
const VISIBLE_MS = 3500;


export default function Toast() {
  const toast = useToastStore((state) => state.toast);
  const dismiss = useToastStore((state) => state.dismiss);

  /**
   * How far the tab bar reaches up the screen, so the banner clears it.
   *
   * This used to be a flat 64 — "roughly the tab bar's height" — which was
   * wrong for the same reason the tab bar itself was. The bar is
   * `TAB_BAR_HEIGHT + insets.bottom`, so on three-button navigation it stands
   * around 108dp and a banner at 64 would have landed ON the tabs: precisely
   * what the clearance exists to prevent, in the one component whose job is to
   * not cover them.
   *
   * `useBottomTabBarHeight()` would be the direct way to ask, but this is
   * mounted in the root layout, OUTSIDE the Tabs navigator, so that hook has no
   * context to read. The inset is the honest source here.
   */
  const insets = useSafeAreaInsets();

  const id = toast?.id;

  useEffect(() => {
    if (id === undefined) return;
    const timer = setTimeout(() => dismiss(id), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [id, dismiss]);

  if (!toast) return null;

  const failed = toast.tone === 'error';

  return (
    <View
      style={[styles.wrapper, { bottom: TAB_BAR_HEIGHT + TOAST_GAP + insets.bottom }]}
      pointerEvents="none">
      <View style={[styles.toast, failed && styles.toastError]}>
        <Ionicons
          name={failed ? 'alert-circle' : 'checkmark-circle'}
          size={18}
          color="#FFFFFF"
        />
        {/* Announced by the screen reader without stealing focus. */}
        <Text style={styles.text} accessibilityLiveRegion="polite" numberOfLines={3}>
          {toast.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    // `bottom` is set inline: it depends on the device's inset.
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: 520,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 10,
    backgroundColor: Colors.inStock,
  },
  toastError: { backgroundColor: Colors.outOfStock },
  text: { flex: 1, color: '#FFFFFF', fontSize: FontSizes.body, fontWeight: '600' },
});
