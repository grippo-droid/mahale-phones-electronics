/**
 * Colour, spacing and type scale per Frontend Spec Section 3.
 *
 * The brand blue below is confirmed and final — the Frontend Spec Section 6 open
 * decision on branding is closed. The remaining visual pass lands in T7.4.
 */

export const Colors = {
  brand: '#1565C0',
  brandDark: '#0D47A1',

  // Status colours (Frontend Spec 3): green in-stock, amber low, red out/error.
  inStock: '#2E7D32',
  lowStock: '#ED6C02',
  outOfStock: '#C62828',

  text: '#111111',
  textMuted: '#5F6368',
  background: '#FFFFFF',
  surface: '#F4F6F8',
  border: '#DADCE0',

  /**
   * Tinted grounds for the colours above, used by banners and nudges.
   *
   * They were seven literals scattered across four files before T7.4, and two
   * of them were ambers one shade apart — `#FFF6E5` on the Dashboard's
   * low-stock banner and `#FFF4E5` on the product form's warning — which is
   * exactly the drift that a palette exists to prevent. A tint is a colour
   * decision like any other and belongs here with the colour it tints.
   */
  brandTint: '#E8F0FB',
  brandTintPressed: '#D6E4F7',
  inStockTint: '#E8F5E9',
  lowStockTint: '#FFF6E5',
  lowStockTintPressed: '#FDEBCD',
  outOfStockTint: '#FDECEA',
} as const;

/** Large tap targets — the app is used quickly, often one-handed (Frontend Spec 3). */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  minTapTarget: 48,
} as const;

export const FontSizes = {
  small: 14,
  body: 16,
  title: 20,
  heading: 28,
} as const;

/**
 * The tab bar's own height, BEFORE the device's bottom inset is added.
 *
 * ---------------------------------------------------------------------------
 * Taller than React Navigation's default of 49, deliberately: this is the
 * control the owner uses most and the one most often tapped one-handed
 * mid-sale.
 *
 * **It is never the whole height, and nothing may treat it as such.** Android
 * draws the app edge to edge, so the system's own navigation bar sits over the
 * bottom of the screen — roughly 16-24dp on gesture navigation and around 48dp
 * on three buttons. Whatever uses this must add `useSafeAreaInsets().bottom`
 * itself.
 *
 * That is the whole reason this is a shared constant rather than two literals.
 * It was `height: 60` in the tab layout and a separate `64` in the toast, and
 * BOTH were wrong in the same way — the tab bar's bottom rows sat under the
 * system bar, and the toast that exists to clear the tab bar would have landed
 * on top of it once the bar grew. One of them being corrected and the other
 * forgotten is exactly the drift the palette and the category chips already
 * taught.
 * ---------------------------------------------------------------------------
 */
export const TAB_BAR_HEIGHT = 60;

/** The gap between the toast and the top of the tab bar. */
export const TOAST_GAP = 4;
