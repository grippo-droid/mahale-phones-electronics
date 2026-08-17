import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { getSalesSummary } from '@/db/bills';
import { countLowStockProducts } from '@/db/products';
import { formatRupees } from '@/lib/format';
import { selectItemCount, useCartStore } from '@/store/cart';
import { selectBusiness, useSettingsStore } from '@/store/settings';

/**
 * Dashboard (T5.1).
 *
 * Replaces the temporary database verification panel that has been sitting here
 * since T1.5 — seed and clear buttons have no business on the shop owner's home
 * screen. `db/seed.ts` still exists for the test harness.
 *
 * Everything here is computed from the database on each visit rather than
 * cached. These are counts over a few hundred rows at most; a stale figure on
 * the screen the owner checks first would cost more than the query does.
 *
 * The recent bills list is T5.3 and the tappable low-stock banner T5.4.
 */

type Stats = {
  todayTotal: number;
  todayBills: number;
  monthTotal: number;
  lowStock: number;
};

/** Midnight on the first of the current month, in local time. */
function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export default function DashboardScreen() {
  const business = useSettingsStore(selectBusiness);
  const cartCount = useCartStore(selectItemCount);

  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const [today, month, lowStock] = await Promise.all([
        // Both ends are today: getSalesSummary widens them to the local day, so
        // a bill raised at 9pm counts towards that evening and not tomorrow.
        getSalesSummary(now, now),
        getSalesSummary(startOfMonth(now), now),
        countLowStockProducts(),
      ]);

      setStats({
        todayTotal: today.total,
        todayBills: today.billCount,
        monthTotal: month.total,
        lowStock,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Re-read whenever the tab comes into view — the figures move every time a
  // bill is generated or stock is adjusted on another tab.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const shopName = business.name.startsWith('PLACEHOLDER') ? 'Your shop' : business.name;

  if (loading && !stats) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View>
        <Text style={styles.shopName} numberOfLines={1}>
          {shopName}
        </Text>
        <Text style={styles.today}>
          {new Date().toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={Colors.outOfStock} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Today's takings get the most weight on the screen: it is the number
          the owner opens the app to see. */}
      <View style={styles.headline}>
        <Text style={styles.headlineLabel}>Today’s sales</Text>
        <Text style={styles.headlineValue}>{formatRupees(stats?.todayTotal ?? 0)}</Text>
        <Text style={styles.headlineSub}>
          {stats?.todayBills ?? 0} {stats?.todayBills === 1 ? 'bill' : 'bills'} today
        </Text>
      </View>

      {/* The most frequent action on the app, so it gets the largest target on
          the screen and sits directly under the figure the owner came to see.

          It says "Continue bill" when something is already in the cart. Tapping
          a button marked "New Bill" and landing on a half-built bill from ten
          minutes ago would look like a fault; naming it honestly costs nothing
          and the cart is deliberately kept (see store/cart.ts). */}
      <Pressable
        style={({ pressed }) => [styles.newBill, pressed && styles.newBillPressed]}
        onPress={() => router.navigate('/billing')}
        accessibilityRole="button"
        accessibilityLabel={
          cartCount > 0
            ? `Continue the bill in progress, ${cartCount} items`
            : 'Start a new bill'
        }>
        <Ionicons name={cartCount > 0 ? 'arrow-forward-circle' : 'add-circle'} size={28} color="#FFFFFF" />
        <View style={styles.newBillText}>
          <Text style={styles.newBillLabel}>{cartCount > 0 ? 'Continue bill' : 'New Bill'}</Text>
          {cartCount > 0 ? (
            <Text style={styles.newBillSub}>
              {cartCount} {cartCount === 1 ? 'item' : 'items'} on the bill
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.statRow}>
        <StatCard
          icon="receipt"
          label="Bills today"
          value={String(stats?.todayBills ?? 0)}
          tone="neutral"
        />
        <StatCard
          icon="alert-circle"
          label="Low stock"
          value={String(stats?.lowStock ?? 0)}
          tone={stats && stats.lowStock > 0 ? 'warning' : 'neutral'}
        />
      </View>

      <View style={styles.monthRow}>
        <Text style={styles.monthLabel}>
          {new Date().toLocaleDateString('en-IN', { month: 'long' })} so far
        </Text>
        <Text style={styles.monthValue}>{formatRupees(stats?.monthTotal ?? 0)}</Text>
      </View>

      <Text style={styles.footnote}>
        Recent bills and the low-stock shortcut come next.
      </Text>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

type StatCardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone: 'neutral' | 'warning';
};

function StatCard({ icon, label, value, tone }: StatCardProps) {
  const warning = tone === 'warning';
  return (
    <View style={[styles.card, warning && styles.cardWarning]}>
      <Ionicons
        name={icon}
        size={22}
        color={warning ? Colors.lowStock : Colors.textMuted}
      />
      <Text style={[styles.cardValue, warning && styles.cardValueWarning]}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },

  shopName: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  today: { fontSize: FontSizes.small, color: Colors.textMuted },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    padding: Spacing.md,
    borderRadius: 8,
    backgroundColor: '#FDECEA',
  },
  errorText: { flex: 1, fontSize: FontSizes.small, color: Colors.outOfStock },

  headline: {
    padding: Spacing.lg,
    borderRadius: 12,
    backgroundColor: Colors.brand,
    gap: 2,
  },
  headlineLabel: { fontSize: FontSizes.small, color: '#FFFFFF', opacity: 0.85 },
  headlineValue: {
    fontSize: FontSizes.heading + 4,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  headlineSub: { fontSize: FontSizes.small, color: '#FFFFFF', opacity: 0.85 },

  newBill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: Spacing.minTapTarget + 24,
    borderRadius: 12,
    backgroundColor: Colors.inStock,
  },
  newBillPressed: { opacity: 0.85 },
  newBillText: { flex: 1 },
  newBillLabel: { fontSize: FontSizes.title, fontWeight: '700', color: '#FFFFFF' },
  newBillSub: { fontSize: FontSizes.small, color: '#FFFFFF', opacity: 0.9 },

  statRow: { flexDirection: 'row', gap: Spacing.md },
  card: {
    flex: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  cardWarning: { borderColor: Colors.lowStock, backgroundColor: '#FFF6E5' },
  cardValue: {
    fontSize: FontSizes.heading,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  cardValueWarning: { color: Colors.lowStock },
  cardLabel: { fontSize: FontSizes.small, color: Colors.textMuted },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  monthLabel: { fontSize: FontSizes.body, color: Colors.textMuted },
  monthValue: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },

  footnote: {
    fontSize: FontSizes.small,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingTop: Spacing.sm,
  },
});
