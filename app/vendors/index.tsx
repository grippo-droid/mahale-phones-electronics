import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  FlatList,
} from 'react-native';

import ErrorBanner from '@/components/ErrorBanner';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import {
  createVendor,
  deleteVendor,
  listVendorsWithTotals,
  type VendorWithTotals,
} from '@/db/vendors';
import { formatRupees } from '@/lib/format';
import { useToastStore } from '@/store/toast';

/**
 * Who the shop buys from, and what it still owes them (T10.3).
 *
 * The vendor-side answer to the question History answers for customers: who is
 * owed, and how much. Vendors with a balance sort to the top, because that is
 * what the screen is opened for — the rest is a directory.
 */

const SEARCH_DEBOUNCE_MS = 250;

export default function VendorsScreen() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [vendors, setVendors] = useState<VendorWithTotals[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const show = useToastStore((state) => state.show);

  /** Stale replies are dropped, as on every other list here. */
  const requestId = useRef(0);

  // Debounced in an effect, not in the change handler: a timer started there
  // has nowhere to return its cleanup to, so every keystroke would leave one
  // running and the last to fire would win rather than the latest typed.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const rows = await listVendorsWithTotals(search);
      if (id !== requestId.current) return;
      setVendors(rows);
      setError(null);
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [search]);

  // The only loader, for the reason History has only one: `useFocusEffect`
  // re-runs whenever its callback changes while focused, so a second effect
  // beside it is a duplicate query rather than a safety net.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );


  const saveVendor = useCallback(async () => {
    setSaving(true);
    try {
      const created = await createVendor({ name: newName, phone: newPhone });
      setAdding(false);
      setNewName('');
      setNewPhone('');
      show(`Saved — ${created.name}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [newName, newPhone, show, load]);

  const confirmDelete = useCallback(
    (vendor: VendorWithTotals) => {
      Alert.alert(
        vendor.name,
        vendor.purchaseCount > 0
          ? `${vendor.purchaseCount} ${vendor.purchaseCount === 1 ? 'purchase is' : 'purchases are'} recorded against this vendor, so they cannot be removed.`
          : 'Remove this vendor?',
        vendor.purchaseCount > 0
          ? [{ text: 'OK', style: 'cancel' }]
          : [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await deleteVendor(vendor.id);
                    show(`Removed — ${vendor.name}`);
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                },
              },
            ]
      );
    },
    [show, load]
  );

  // Owed first, largest first, then the rest alphabetically. The repository
  // returns them by name; the sort that matters on this screen is money.
  const ordered = [...vendors].sort((a, b) => {
    if (a.owed !== b.owed) return b.owed - a.owed;
    return a.name.localeCompare(b.name);
  });

  const totalOwed = Math.round(vendors.reduce((sum, v) => sum + v.owed * 100, 0)) / 100;

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search vendors by name or phone"
          placeholderTextColor={Colors.textMuted}
          value={searchInput}
          onChangeText={setSearchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
        {searchInput.length > 0 ? (
          <Pressable
            onPress={() => {
              setSearchInput('');
              setSearch('');
            }}
            hitSlop={12}
            accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <ErrorBanner message={error} style={styles.errorBanner} />

      {totalOwed > 0 ? (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Owed to vendors</Text>
          <Text style={styles.summaryValue}>{formatRupees(totalOwed)}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.brand} />
        </View>
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <VendorRowItem vendor={item} onLongPress={() => confirmDelete(item)} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>
                {search.trim() ? 'No vendor matches that' : 'No vendors yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {search.trim()
                  ? 'Try part of their name or phone number.'
                  : 'Add the shops and suppliers you buy from, then record what you buy and what you have paid.'}
              </Text>
            </View>
          }
        />
      )}

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => setAdding(true)}
        accessibilityRole="button"
        accessibilityLabel="Add a vendor">
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </Pressable>

      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>New vendor</Text>
            <TextInput
              style={styles.field}
              placeholder="Name"
              placeholderTextColor={Colors.textMuted}
              value={newName}
              onChangeText={setNewName}
              autoFocus
              accessibilityLabel="Vendor name"
            />
            <TextInput
              style={styles.field}
              placeholder="Phone (optional)"
              placeholderTextColor={Colors.textMuted}
              value={newPhone}
              onChangeText={setNewPhone}
              keyboardType="phone-pad"
              accessibilityLabel="Vendor phone number"
            />
            <View style={styles.cardButtons}>
              <Pressable
                style={styles.cardButton}
                onPress={() => setAdding(false)}
                disabled={saving}
                accessibilityRole="button">
                <Text style={styles.cardButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.cardButton, styles.cardButtonPrimary]}
                onPress={saveVendor}
                disabled={saving || newName.trim() === ''}
                accessibilityRole="button">
                <Text style={[styles.cardButtonText, styles.cardButtonTextPrimary]}>
                  {saving ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function VendorRowItem({
  vendor,
  onLongPress,
}: {
  vendor: VendorWithTotals;
  onLongPress: () => void;
}) {
  const owes = vendor.owed > 0;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() =>
        router.push({ pathname: '/vendors/[id]', params: { id: String(vendor.id) } })
      }
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={
        owes
          ? `${vendor.name}, ${formatRupees(vendor.owed)} owed across ${vendor.purchaseCount} purchases`
          : `${vendor.name}, nothing owed`
      }>
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>
          {vendor.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {vendor.purchaseCount === 0
            ? 'No purchases yet'
            : `${vendor.purchaseCount} ${vendor.purchaseCount === 1 ? 'purchase' : 'purchases'} · ${formatRupees(vendor.purchased)}`}
          {vendor.phone ? ` · ${vendor.phone}` : ''}
        </Text>
      </View>

      {/* Amber, like every other "money still to come" in this app. Red stays
          for things that are wrong. */}
      {owes ? (
        <View style={styles.amount}>
          <Text style={styles.owed}>{formatRupees(vendor.owed)}</Text>
          <Text style={styles.owedLabel}>owed</Text>
        </View>
      ) : (
        <Text style={styles.settled}>Settled</Text>
      )}
      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    margin: Spacing.md,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
    backgroundColor: Colors.surface,
  },
  searchInput: { flex: 1, fontSize: FontSizes.body, color: Colors.text },
  errorBanner: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm },

  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
    backgroundColor: Colors.lowStockTint,
  },
  summaryLabel: { fontSize: FontSizes.small, fontWeight: '700', color: Colors.lowStock },
  summaryValue: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.lowStock,
    fontVariant: ['tabular-nums'],
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingBottom: 96 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surface },
  rowMain: { flex: 1, gap: 2 },
  rowName: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  rowMeta: { fontSize: FontSizes.small, color: Colors.textMuted },
  amount: { alignItems: 'flex-end' },
  owed: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.lowStock,
    fontVariant: ['tabular-nums'],
  },
  owedLabel: { fontSize: FontSizes.small, color: Colors.textMuted },
  settled: { fontSize: FontSizes.small, color: Colors.inStock, fontWeight: '600' },

  empty: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: FontSizes.body, color: Colors.textMuted, textAlign: 'center' },

  fab: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.brand,
  },
  fabPressed: { backgroundColor: Colors.brandDark },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  card: { backgroundColor: Colors.background, borderRadius: 12, padding: Spacing.md, gap: Spacing.sm },
  cardTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  field: {
    minHeight: Spacing.minTapTarget,
    paddingHorizontal: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: FontSizes.body,
    color: Colors.text,
  },
  cardButtons: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
  cardButton: {
    minHeight: Spacing.minTapTarget,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    borderRadius: 8,
  },
  cardButtonPrimary: { backgroundColor: Colors.brand },
  cardButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.brand },
  cardButtonTextPrimary: { color: '#FFFFFF' },
});
