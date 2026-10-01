import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, FontSizes, TAB_BAR_HEIGHT } from '@/constants/theme';

/** Breathing room around the icon and label, inside the bar's own height. */
const BAR_PADDING = 6;

/**
 * Bottom tab navigation per Frontend Spec Section 1:
 * [ Dashboard ] [ Inventory ] [ Billing ] [ History ] [ Settings ]
 */
export default function TabLayout() {
  /**
   * The device's own bottom inset, added to the bar rather than guessed.
   *
   * -------------------------------------------------------------------------
   * Android draws this app edge to edge, so the system navigation bar is drawn
   * OVER the bottom of the screen. React Navigation handles that by itself —
   * but only while nothing overrides it, and `tabBarStyle` overrode it twice:
   *
   *   - `getTabBarHeight` returns a numeric `height` from the style
   *     immediately, before it reaches the line that adds the inset. So
   *     `height: 60` meant exactly 60, system bar included.
   *   - `tabBarStyle` is applied LAST in the tab bar's style array, so a
   *     literal `paddingBottom` replaces the computed `paddingBottom:
   *     insets.bottom`.
   *
   * The result was a 60dp bar with up to ~48dp of it underneath the system
   * buttons, which clipped the icons and labels on three-button navigation.
   *
   * Keeping an explicit height rather than letting the library compute one is
   * deliberate — the default is 49 and this bar is the app's most-used control
   * — so the inset is added here instead. Nothing here is a guessed value:
   * `insets.bottom` is whatever the device reports.
   * -------------------------------------------------------------------------
   */
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.brand,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: { fontSize: FontSizes.small - 2 },
        tabBarStyle: {
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: BAR_PADDING + insets.bottom,
          paddingTop: BAR_PADDING,
        },
        headerStyle: { backgroundColor: Colors.brand },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '600' },
      }}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="billing"
        options={{
          title: 'Billing',
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
        }}
      />
      {/* Its own tab rather than a section of History: the two answer different
          questions — History is "what did we sell?", this is "what are we still
          waiting to hear back about?" — and only the second has money still on
          the table. Labelled "Quotes" because six tab labels have to fit a
          phone; the screens themselves say "Quotation" in full. */}
      <Tabs.Screen
        name="quotations"
        options={{
          title: 'Quotes',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
