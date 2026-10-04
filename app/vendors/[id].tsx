import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import ErrorBanner from '@/components/ErrorBanner';
import PaymentTags from '@/components/PaymentTags';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { getVendorById, getVendorTotals } from '@/db/vendors';
import { listPurchases } from '@/db/purchases';
import { listPaymentsForPurchases } from '@/db/purchasePayments';
import type { PurchaseRow, VendorRow } from '@/db/schema';
import { formatBillDay, formatRupees, formatTime } from '@/lib/format';
import { purchaseSettlement, type VendorTotals } from '@/lib/purchase';

/**
 * One vendor: what they have been bought from, paid, and are still owed, and
 * every purchase behind those figures (T10.3).
 *
 * The rollup sits at the top because it is the question the screen is opened
 * for. The list below is the working of it.
 */
export default function VendorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vendorId = Number.parseInt(id ?? '', 10);

  const [vendor, setVendor] = useState<VendorRow | null>(null);
  const [totals, setTotals] = useState<VendorTotals | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [ledgers, setLedgers] = useState<Map<number, number[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(vendorId)) {
      setLoading(false);
      return;
    }
    try {
      const [found, rollup, rows] = await Promise.all([
        getVendorById(vendorId),
        getVendorTotals(vendorId),
        listPurchases({ vendorId }),
      ]);
      setVendor(found);
      setTotals(rollup);
      setPurchases(rows);

      // One query for every ledger on screen, not one per row — the same
      // reason `listPaymentsForBills` exists for History.
      const byPurchase = await listPaymentsForPurchases(rows.map((row) => row.id));
      const amounts = new Map<number, number[]>();
      for (const row of rows) {
        amounts.set(row.id, (byPurchase.get(row.id) ?? []).map((p) => p.amount));
      }
      setLedgers(amounts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Vendor' }} />
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  if (!vendor) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Vendor' }} />
        <Ionicons name="alert-circle-outline" size={40} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>That vendor could not be found</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: vendor.name }} />

      <ErrorBanner message={error} style={styles.errorBanner} />

      <FlatList
        data={purchases}
        keyExtractor={(item) => String(item.id)}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <View style={styles.rollup}>
              <Figure label="Purchased" value={totals?.purchased ?? 0} />
              <Figure label="Paid" value={totals?.paid ?? 0} tone="good" />
              <Figure label="Owed" value={totals?.owed ?? 0} tone="owed" />
            </View>
            {vendor.phone ? <Text style={styles.phone}>{vendor.phone}</Text> : null}
            {vendor.notes ? <Text style={styles.notes}>{vendor.notes}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.newPurchase, pressed && styles.newPurchasePressed]}
              onPress={() =>
                router.push({
                  pathname: '/purchase/new',
                  params: { vendorId: String(vendor.id) },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Record a purchase from ${vendor.name}`}>
              <Ionicons name="add-circle" size={24} color="#FFFFFF" />
              <Text style={styles.newPurchaseText}>Record a purchase</Text>
            </Pressable>

            {purchases.length > 0 ? <Text style={styles.heading}>Purchases</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <PurchaseRowItem purchase={item} amounts={ledgers.get(item.id) ?? []} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyBody}>
              Nothing recorded from this vendor yet.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'good' | 'owed';
}) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text
        style={[
          styles.figureValue,
          tone === 'good' && styles.figureGood,
          tone === 'owed' && value > 0 && styles.figureOwed,
        ]}>
        {formatRupees(value)}
      </Text>
    </View>
  );
}

function PurchaseRowItem({
  purchase,
  amounts,
}: {
  purchase: PurchaseRow;
  amounts: number[];
}) {
  const totals = purchaseSettlement(purchase, amounts);
  const partPaid = totals.state === 'partial';

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() =>
        router.push({ pathname: '/purchase/[id]', params: { id: String(purchase.id) } })
      }
      accessibilityRole="button"
      accessibilityLabel={
        partPaid
          ? `Purchase of ${formatRupees(purchase.total_amount)}, ${formatRupees(totals.outstanding)} owed`
          : `Purchase of ${formatRupees(purchase.total_amount)}, ${totals.state === 'paid' ? 'settled' : 'unpaid'}`
      }>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {purchase.vendor_ref ? purchase.vendor_ref : 'No bill number'}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {formatBillDay(purchase.date)}, {formatTime(purchase.date)}
          {purchase.stock_applied === 1 ? '' : ' · stock not updated'}
        </Text>
        {/* No payment TYPE on a purchase — there is no Cash/Credit decision
            being struck here — so only the status pill shows. */}
        <PaymentTags paymentType={null} state={totals.state} />
      </View>

      {partPaid ? (
        <View style={styles.amount}>
          <Text style={styles.owed}>{formatRupees(totals.outstanding)}</Text>
          <Text style={styles.owedLabel}>
            owed of {formatRupees(purchase.total_amount)}
          </Text>
        </View>
      ) : (
        <Text style={styles.total}>{formatRupees(purchase.total_amount)}</Text>
      )}
      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  errorBanner: { margin: Spacing.md },

  list: { flex: 1 },
  listContent: { paddingBottom: Spacing.xl },

  rollup: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  figure: { flex: 1, gap: 2 },
  figureLabel: { fontSize: FontSizes.small, color: Colors.textMuted },
  figureValue: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  figureGood: { color: Colors.inStock },
  figureOwed: { color: Colors.lowStock },

  phone: { paddingHorizontal: Spacing.md, fontSize: FontSizes.small, color: Colors.textMuted },
  notes: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    fontSize: FontSizes.small,
    color: Colors.textMuted,
  },

  newPurchase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    margin: Spacing.md,
    paddingHorizontal: Spacing.md,
    minHeight: 56,
    borderRadius: 10,
    backgroundColor: Colors.brand,
  },
  newPurchasePressed: { backgroundColor: Colors.brandDark },
  newPurchaseText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },

  heading: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs,
    fontSize: FontSizes.small,
    fontWeight: '700',
    color: Colors.textMuted,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surface },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  rowMeta: { fontSize: FontSizes.small, color: Colors.textMuted },
  amount: { alignItems: 'flex-end' },
  owed: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.lowStock,
    fontVariant: ['tabular-nums'],
  },
  owedLabel: { fontSize: FontSizes.small, color: Colors.textMuted },
  total: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },

  empty: { alignItems: 'center', padding: Spacing.xl },
  emptyTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: FontSizes.body, color: Colors.textMuted, textAlign: 'center' },
});
