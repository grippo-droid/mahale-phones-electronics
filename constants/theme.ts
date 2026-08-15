/**
 * Colour, spacing and type scale per Frontend Spec Section 3.
 *
 * NOTE: `brand` is a PLACEHOLDER blue. Frontend Spec Section 6 lists "confirm
 * brand colours (existing shop branding, if any)" as an open decision — swap
 * this once the shop's signage/logo colours are confirmed. The full visual pass
 * lands in T7.4.
 */

export const Colors = {
  brand: '#1565C0', // PLACEHOLDER — pending confirmation of shop branding
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
