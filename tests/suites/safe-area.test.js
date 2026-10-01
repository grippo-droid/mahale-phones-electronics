'use strict';

/**
 * Nothing anchored to the bottom edge may ignore the device's inset (T9.10).
 *
 * ---------------------------------------------------------------------------
 * Scope, stated plainly: there is no renderer here, so this cannot measure a
 * tab bar or tell you whether anything is actually clipped on a phone. That
 * needs a build, and it is the only thing that settles it.
 *
 * What it CAN hold is the shape of the mistake, which was textual and was made
 * twice in the same codebase:
 *
 *   - `app/(tabs)/_layout.tsx` set `tabBarStyle: { height: 60,
 *     paddingBottom: 6 }`. Android draws the app edge to edge, and React
 *     Navigation adds `insets.bottom` itself — but `getTabBarHeight` returns a
 *     numeric `height` from the style BEFORE it reaches the line that adds the
 *     inset, and `tabBarStyle` is applied last in the style array so a literal
 *     `paddingBottom` replaces the computed one. Both escapes were taken, and
 *     up to ~48dp of a 60dp bar sat under the system buttons.
 *
 *   - `components/Toast.tsx` had `TAB_BAR_CLEARANCE = 64`, "roughly the tab
 *     bar's height". Once the bar is 60 + inset it stands around 108dp, so the
 *     banner whose entire purpose is to NOT cover the tabs would have sat on
 *     them.
 *
 * Both are now `TAB_BAR_HEIGHT + insets.bottom`. The constant is shared so a
 * third site cannot quietly invent its own number.
 * ---------------------------------------------------------------------------
 */

const { readSource, readSourceWithoutComments } = require('../harness/check');
const { TAB_BAR_HEIGHT, TOAST_GAP } = require('@/constants/theme');

/** Files that place something against the bottom edge of the screen. */
const BOTTOM_ANCHORED = [
  ['the tab bar', 'app/(tabs)/_layout.tsx'],
  ['the toast', 'components/Toast.tsx'],
];

async function run({ check, section }) {
  section('the height has one definition');
  check('TAB_BAR_HEIGHT is exported', typeof TAB_BAR_HEIGHT, 'number');
  check('and is the taller bar, not the library default of 49', TAB_BAR_HEIGHT, 60);
  check('TOAST_GAP is exported', typeof TOAST_GAP, 'number');

  section('both bottom-anchored files read the inset');
  for (const [name, file] of BOTTOM_ANCHORED) {
    const source = readSourceWithoutComments(file);
    check(`${name} imports useSafeAreaInsets`,
      /import\s*\{[^}]*useSafeAreaInsets[^}]*\}\s*from\s*'react-native-safe-area-context'/.test(source),
      true);
    check(`${name} calls it`, /useSafeAreaInsets\(\)/.test(source), true);
    check(`${name} uses the shared height`, /TAB_BAR_HEIGHT/.test(source), true);
    // The point of the whole ticket: the inset is ADDED, not assumed away.
    check(`${name} adds insets.bottom to its offset`,
      /TAB_BAR_HEIGHT\s*\+[^;,\n]*insets\.bottom/.test(source), true);
  }

  section('the tab bar pads for the system bar as well as sizing for it');
  // Two separate escapes in React Navigation, so two separate fixes. Height
  // alone would leave the icons sitting in the padded region; padding alone
  // would leave the bar too short.
  const layout = readSourceWithoutComments('app/(tabs)/_layout.tsx');
  check('height carries the inset',
    /height:\s*TAB_BAR_HEIGHT\s*\+\s*insets\.bottom/.test(layout), true);
  check('paddingBottom carries it too',
    /paddingBottom:\s*[A-Za-z_]+\s*\+\s*insets\.bottom/.test(layout), true);
  check('paddingTop does NOT — there is no inset at the top of a bottom bar',
    /paddingTop:\s*[A-Za-z_]+\s*\+\s*insets\.bottom/.test(layout), false);

  section('no bare literal is left standing in for the bar');
  // The two originals, by value. Either reappearing means somebody has gone
  // back to guessing.
  check('the tab layout no longer hard-codes 60', /height:\s*60\b/.test(layout), false);
  const toast = readSourceWithoutComments('components/Toast.tsx');
  check('the toast no longer hard-codes 64', /\b64\b/.test(toast), false);
  check('and defines no clearance constant of its own',
    /TAB_BAR_CLEARANCE/.test(toast), false);

  section('the toast still clears the bar rather than matching it');
  check('it offsets by the bar plus a gap',
    /TAB_BAR_HEIGHT\s*\+\s*TOAST_GAP\s*\+\s*insets\.bottom/.test(toast), true);
  check('the gap is positive, or the banner touches the tabs', TOAST_GAP > 0, true);
  // bottom is applied inline because it depends on the device; a static
  // StyleSheet value cannot see an inset.
  check('bottom is not frozen into the stylesheet',
    /wrapper:\s*\{[^}]*bottom:/.test(readSource('components/Toast.tsx')), false);

  section('the toast is still the thing it was');
  // Guard rails on the fix: it must not have changed what the component is for.
  check('it still never takes a touch', /pointerEvents="none"/.test(toast), true);
  check('and still dismisses on its own id',
    /dismiss\(id\)/.test(toast), true);
}

module.exports = { run };
