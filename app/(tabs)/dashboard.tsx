import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { getRecentBills, getSalesSummary } from '@/db/bills';
import { countLowStockProducts, countProducts, listProducts } from '@/db/products';
import { clearAllData, seedDatabase } from '@/db/seed';
import type { BillRow } from '@/db/schema';
import type { Product } from '@/db/products';

/**
 * TEMPORARY database verification panel (T1.5).
 *
 * The real Dashboard is built in T5.1–T5.4 and replaces all of this. It exists
 * only so the database layer can be exercised on a real phone before any feature
 * UI exists — seed data, read it back, and confirm the numbers are right.
 */

type Snapshot = {
  productCount: number;
  lowStockCount: number;
  todayBills: number;
  todayTotal: number;
  recentBills: BillRow[];
  flagged: Product[];
};

export default function DashboardScreen() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const today = new Date();
      const [productCount, lowStockCount, summary, recentBills, flagged] = await Promise.all([
        countProducts(),
        countLowStockProducts(),
        getSalesSummary(today, today),
        getRecentBills(5),
        listProducts({ lowStockOnly: true }),
      ]);

      setSnapshot({
        productCount,
        lowStockCount,
        todayBills: summary.billCount,
        todayTotal: summary.total,
        recentBills,
        flagged,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runSeed = async () => {
    setBusy(true);
    try {
      const result = await seedDatabase();
      await load();
      Alert.alert(
        'Sample data added',
        `${result.productsCreated} products and ${result.billsCreated} bills created.`
      );
    } catch (err) {
      Alert.alert('Could not seed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmClear = () => {
    Alert.alert(
      'Clear all data?',
      'Deletes every product and bill in the database. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await clearAllData();
              await load();
            } catch (err) {
              Alert.alert('Could not clear', err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <View style={styles.devBanner}>
        <Text style={styles.devBannerText}>
          Temporary database check (T1.5) — replaced by the real Dashboard in Phase 5
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.statRow}>
        <Stat label="Products" value={String(snapshot?.productCount ?? '—')} />
        <Stat
          label="Low stock"
          value={String(snapshot?.lowStockCount ?? '—')}
          tone={snapshot && snapshot.lowStockCount > 0 ? Colors.lowStock : undefined}
        />
      </View>
      <View style={styles.statRow}>
        <Stat label="Bills today" value={String(snapshot?.todayBills ?? '—')} />
        <Stat
          label="Sales today"
          value={snapshot ? formatRupees(snapshot.todayTotal) : '—'}
        />
      </View>

      <Text style={styles.sectionTitle}>Recent bills</Text>
      {snapshot?.recentBills.length ? (
        snapshot.recentBills.map((bill) => (
          <View key={bill.id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{bill.invoice_number}</Text>
              <Text style={styles.rowSub}>
                {bill.customer_name} · {new Date(bill.date).toLocaleDateString('en-IN')}
              </Text>
              <Text style={styles.rowSub}>
                {bill.igst_total > 0
                  ? `IGST ${formatRupees(bill.igst_total)}`
                  : `CGST ${formatRupees(bill.cgst_total)} + SGST ${formatRupees(bill.sgst_total)}`}
              </Text>
            </View>
            <Text style={styles.rowAmount}>{formatRupees(bill.grand_total)}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>No bills yet.</Text>
      )}

      <Text style={styles.sectionTitle}>Stock needing attention</Text>
      {snapshot?.flagged.length ? (
        snapshot.flagged.map((product) => (
          <View key={product.id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{product.name}</Text>
              <Text style={styles.rowSub}>
                {product.category} · threshold {product.effectiveLowStockThreshold}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: stockColour(product.stockStatus) }]}>
              <Text style={styles.pillText}>
                {product.stockStatus === 'negative'
                  ? `OVERSOLD ${product.stock_qty}`
                  : `${product.stock_qty} left`}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>Nothing low on stock.</Text>
      )}

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          disabled={busy}
          onPress={runSeed}>
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Add sample data</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.button, styles.buttonDanger, busy && styles.buttonDisabled]}
          disabled={busy}
          onPress={confirmClear}>
          <Text style={styles.buttonText}>Clear all data</Text>
        </Pressable>
      </View>

      <Text style={styles.footnote}>
        Sample data is for testing only. Its HSN codes and GST rates are illustrative, not verified
        tax classifications. Clear it before the shop uses the app for real.
      </Text>
    </ScrollView>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function stockColour(status: Product['stockStatus']): string {
  switch (status) {
    case 'negative':
    case 'out':
      return Colors.outOfStock;
    case 'low':
      return Colors.lowStock;
    default:
      return Colors.inStock;
  }
}

/** Indian digit grouping (1,23,456.78) — Frontend Spec Section 4. */
function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl },
  devBanner: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.sm,
    marginBottom: Spacing.md,
  },
  devBannerText: { fontSize: FontSizes.small, color: Colors.textMuted, textAlign: 'center' },
  error: {
    color: Colors.outOfStock,
    fontSize: FontSizes.body,
    marginBottom: Spacing.md,
  },
  statRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md },
  stat: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: Spacing.md,
  },
  statValue: { fontSize: FontSizes.heading, fontWeight: '700', color: Colors.text },
  statLabel: { fontSize: FontSizes.small, color: Colors.textMuted, marginTop: Spacing.xs },
  sectionTitle: {
    fontSize: FontSizes.title,
    fontWeight: '700',
    color: Colors.text,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  rowSub: { fontSize: FontSizes.small, color: Colors.textMuted, marginTop: 2 },
  rowAmount: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  pill: { borderRadius: 999, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm },
  pillText: { color: '#FFFFFF', fontSize: FontSizes.small - 1, fontWeight: '700' },
  empty: { fontSize: FontSizes.body, color: Colors.textMuted, fontStyle: 'italic' },
  actions: { marginTop: Spacing.xl, gap: Spacing.sm },
  button: {
    backgroundColor: Colors.brand,
    borderRadius: 8,
    minHeight: Spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  buttonDanger: { backgroundColor: Colors.outOfStock },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: FontSizes.body, fontWeight: '700' },
  footnote: {
    marginTop: Spacing.md,
    fontSize: FontSizes.small,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
