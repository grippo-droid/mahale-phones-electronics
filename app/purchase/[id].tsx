import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ErrorBanner from '@/components/ErrorBanner';
import PaymentLedger, { type LedgerEntry } from '@/components/PaymentLedger';
import PaymentTags from '@/components/PaymentTags';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { getPurchaseById, deletePurchase, type PurchaseWithItems } from '@/db/purchases';
import {
  deletePurchasePayment,
  editPurchasePayment,
  listPurchasePayments,
  recordPurchasePayment,
  totalsFor,
  type PurchasePayment,
} from '@/db/purchasePayments';
import { getVendorById } from '@/db/vendors';
import type { VendorRow } from '@/db/schema';
import { formatDate, formatRupees, formatTime } from '@/lib/format';
import { formatQuantityWithUnit } from '@/lib/units';
import { useToastStore } from '@/store/toast';

/**
 * One purchase, and what has been paid against it (T10.3).
 *
 * The internal twin of the bill screen, minus everything a customer sees:
 * nothing here is printed, shared or rendered to a PDF, so there is no stored
 * file to keep in step and no "Open printable bill". What the shop bought and
 * what it still owes, and that is all.
 */
export default function PurchaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const purchaseId = Number.parseInt(id ?? '', 10);

  const [purchase, setPurchase] = useState<PurchaseWithItems | null>(null);
  const [vendor, setVendor] = useState<VendorRow | null>(null);
  const [payments, setPayments] = useState<PurchasePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPayment, setSavingPayment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = useToastStore((state) => state.show);

  const load = useCallback(async () => {
    if (!Number.isFinite(purchaseId)) {
      setLoading(false);
      return;
    }
    try {
      const found = await getPurchaseById(purchaseId);
      setPurchase(found);
      if (found) {
        const [theirVendor, ledger] = await Promise.all([
          getVendorById(found.vendor_id),
          listPurchasePayments(found.id),
        ]);
        setVendor(theirVendor);
        setPayments(ledger);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [purchaseId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const reloadLedger = useCallback(async () => {
    if (!purchase) return;
    setPayments(await listPurchasePayments(purchase.id));
  }, [purchase]);

  const handleRecord = useCallback(
    async (payment: { amount: number; paid_on: string | null; note?: string | null }) => {
      if (!purchase) return;
      setSavingPayment(true);
      try {
        await recordPurchasePayment(purchase.id, payment);
        await reloadLedger();
      } finally {
        setSavingPayment(false);
      }
    },
    [purchase, reloadLedger]
  );

  const handleEdit = useCallback(
    async (paymentId: number, payment: { amount: number; paid_on: string | null }) => {
      setSavingPayment(true);
      try {
        await editPurchasePayment(paymentId, payment);
        await reloadLedger();
      } finally {
        setSavingPayment(false);
      }
    },
    [reloadLedger]
  );

  const handleDelete = useCallback(
    async (payment: LedgerEntry) => {
      setSavingPayment(true);
      try {
        await deletePurchasePayment(payment.id);
        await reloadLedger();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingPayment(false);
      }
    },
    [reloadLedger]
  );

  /**
   * Deleting asks about stock, and only when there is stock to ask about.
   *
   * A purchase saved without applying stock has nothing to take back, so the
   * question is not put — the same reasoning as a bill's delete, which asks
   * every time precisely because there the answer is genuinely either way.
   */
  const confirmDelete = useCallback(() => {
    if (!purchase) return;

    const remove = async (reverseStock: boolean) => {
      try {
        await deletePurchase(purchase.id, { reverseStock });
        show('Purchase removed');
        router.back();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    if (purchase.stock_applied !== 1) {
      Alert.alert(
        'Remove this purchase?',
        'It did not add anything to stock, so nothing on the shelf changes.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => remove(false) },
        ]
      );
      return;
    }

    Alert.alert(
      'Remove this purchase?',
      'It added these items to stock. Should that be taken back off?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Keep the stock', onPress: () => remove(false) },
        { text: 'Take it back off', style: 'destructive', onPress: () => remove(true) },
      ]
    );
  }, [purchase, show]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Purchase' }} />
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  if (!purchase) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Purchase' }} />
        <Ionicons name="alert-circle-outline" size={40} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>That purchase could not be found</Text>
      </View>
    );
  }

  const totals = totalsFor(purchase.total_amount, payments);
  const removed = purchase.deleted_at !== null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: vendor ? vendor.name : 'Purchase' }} />

      <ErrorBanner message={error} />

      {removed ? (
        <View style={styles.removedBanner}>
          <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
          <Text style={styles.removedText}>
            This purchase was removed on {formatDate(purchase.deleted_at as string)}. It is
            kept so the payments against it are not lost.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.headRow}>
          <View>
            <Text style={styles.label}>Their bill number</Text>
            <Text style={styles.value}>{purchase.vendor_ref ?? '—'}</Text>
          </View>
          <View>
            <Text style={styles.label}>Date</Text>
            <Text style={styles.value}>{formatDate(purchase.date)}</Text>
            <Text style={styles.muted}>{formatTime(purchase.date)}</Text>
          </View>
        </View>

        <PaymentTags paymentType={null} state={totals.state} />

        {purchase.stock_applied === 1 ? (
          <Text style={styles.stockNote}>These items were added to stock.</Text>
        ) : (
          <Text style={styles.stockNoteMuted}>
            Stock was not updated for this purchase.
          </Text>
        )}

        {purchase.notes ? <Text style={styles.notes}>{purchase.notes}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Items</Text>
        {purchase.items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <View style={styles.itemMain}>
              <Text style={styles.itemName} numberOfLines={2}>
                {item.product_name_snapshot}
              </Text>
              <Text style={styles.itemSub}>
                {formatQuantityWithUnit(item.qty, item.unit)} at{' '}
                {formatRupees(item.cost_price)}
                {/* A line whose product was later deleted keeps its name here
                    and loses only the link — the same shape as bill_items. */}
                {item.product_id === null ? ' · not linked to Inventory' : ''}
              </Text>
            </View>
            <Text style={styles.itemTotal}>{formatRupees(item.line_total)}</Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total on their bill</Text>
          <Text style={styles.totalValue}>{formatRupees(purchase.total_amount)}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <PaymentLedger
          grandTotal={purchase.total_amount}
          payments={payments}
          onRecord={handleRecord}
          onEdit={handleEdit}
          onDelete={handleDelete}
          busy={savingPayment}
          emptyMessage="Nothing paid yet. Record each payment as it goes out — it can go in parts."
        />
      </View>

      {!removed ? (
        <Pressable
          style={({ pressed }) => [styles.delete, pressed && styles.deletePressed]}
          onPress={confirmDelete}
          accessibilityRole="button"
          accessibilityLabel="Remove this purchase">
          <Ionicons name="trash-outline" size={18} color={Colors.outOfStock} />
          <Text style={styles.deleteText}>Remove this purchase</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },

  removedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: 8,
    backgroundColor: Colors.surface,
  },
  removedText: { flex: 1, fontSize: FontSizes.small, color: Colors.textMuted },

  card: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { fontSize: FontSizes.small, fontWeight: '700', color: Colors.textMuted },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  label: { fontSize: FontSizes.small, color: Colors.textMuted },
  value: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  muted: { fontSize: FontSizes.small, color: Colors.textMuted },
  stockNote: { fontSize: FontSizes.small, color: Colors.inStock },
  stockNoteMuted: { fontSize: FontSizes.small, color: Colors.textMuted },
  notes: { fontSize: FontSizes.small, color: Colors.textMuted },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  itemMain: { flex: 1 },
  itemName: { fontSize: FontSizes.body, color: Colors.text },
  itemSub: { fontSize: FontSizes.small, color: Colors.textMuted },
  itemTotal: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  totalLabel: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  totalValue: {
    fontSize: FontSizes.title,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },

  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
  },
  deletePressed: { backgroundColor: Colors.outOfStockTint },
  deleteText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.outOfStock },
});
