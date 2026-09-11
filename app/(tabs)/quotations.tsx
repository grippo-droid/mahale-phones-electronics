import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import ErrorBanner from '@/components/ErrorBanner';
import QuotationStatusBadge from '@/components/QuotationStatusBadge';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { listQuotations } from '@/db/quotations';
import type { QuotationRow } from '@/db/schema';
import { formatBillDay, formatRupees } from '@/lib/format';
import { confirmDeleteQuotation, startEditingQuotation } from '@/lib/quotationActions';
import {
  selectQuotationItemCount,
  useQuotationStore,
} from '@/store/quotation';

/**
 * Quotations (T5.7) — offers made, separate from bills raised.
 *
 * Its own tab rather than a section of History, because the two answer
 * different questions. History is "what did we sell?"; this is "what are we
 * waiting to hear back about?". Mixing them would make the second question
 * impossible to ask, which is the one with money still on the table.
 *
 * Simpler than History on purpose: no date presets and no running total. A shop
 * has a few dozen open quotations, not thousands of them, and a total of
 * quotations is not a figure that means anything — none of it is money the shop
 * has.
 */

const SEARCH_DEBOUNCE_MS = 250;

export default function QuotationsScreen() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The editor keeps whatever was being worked on, exactly as the billing cart
  // does, so this button has to say which of the two things it will do.
  const draftCount = useQuotationStore(selectQuotationItemCount);
  const editingQuotationId = useQuotationStore((state) => state.editingQuotationId);
  const beginNew = useQuotationStore((state) => state.beginNew);

  /**
   * Opens the editor, and makes sure "New Quotation" means a new one.
   *
   * Backing out of an edit leaves `editingQuotationId` set — the store outlives
   * the screen on purpose. Without this, tapping "New Quotation" reopened that
   * abandoned edit: the title still read "Edit Quotation", the button still
   * read "Save changes", and saving overwrote the quotation the owner thought
   * they had walked away from. Abandoning an edit therefore discards it; its
   * lines belong to that quotation, not to a new one.
   *
   * A genuine draft — items with no quotation behind them — is kept, and the
   * button says "Continue quotation" instead. Same reasoning as the Dashboard's
   * "New Bill" / "Continue bill": landing on someone else's half-built work
   * under a button marked "New" looks like a fault.
   */
  const openEditor = useCallback(() => {
    beginNew();
    router.push('/quotation/new');
  }, [beginNew]);

  const continuing = editingQuotationId === null && draftCount > 0;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const rows = await listQuotations({ search, openOnly });
      setQuotations(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [search, openOnly]);

  // Reloads on every focus, so a quotation just converted on another screen is
  // shown as converted rather than as still open.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /** Edit or delete from the row, mirroring History. */
  const showActions = useCallback(
    (quotation: QuotationRow) => {
      Alert.alert(
        quotation.reference_number,
        `${quotation.customer_name} · ${formatRupees(quotation.grand_total)}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Edit',
            onPress: () => {
              startEditingQuotation(quotation.id).catch((err: Error) => setError(err.message));
            },
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () =>
              confirmDeleteQuotation(
                quotation,
                // Dropped from the list rather than reloaded, so the scroll
                // position survives working through several.
                () =>
                  setQuotations((current) => current.filter((row) => row.id !== quotation.id)),
                setError
              ),
          },
        ]
      );
    },
    []
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search name, phone or Q-number"
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
          />
          {searchInput.length > 0 ? (
            <Pressable onPress={() => setSearchInput('')} hitSlop={Spacing.sm}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.filterChip,
            openOnly && styles.filterChipOn,
            pressed && styles.filterChipPressed,
          ]}
          onPress={() => setOpenOnly((current) => !current)}
          accessibilityRole="button"
          accessibilityState={{ selected: openOnly }}
          accessibilityLabel="Show only quotations that have not become bills">
          <Text style={[styles.filterChipText, openOnly && styles.filterChipTextOn]}>
            Not yet converted
          </Text>
        </Pressable>
      </View>

      <ErrorBanner message={error} style={styles.errorBanner} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.brand} />
        </View>
      ) : (
        <FlatList
          data={quotations}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          contentContainerStyle={
            quotations.length === 0 ? styles.emptyContent : styles.listContent
          }
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <QuotationRowItem quotation={item} onShowActions={showActions} />
          )}
          ListEmptyComponent={<EmptyState search={search} openOnly={openOnly} />}
        />
      )}

      <Pressable
        style={({ pressed }) => [styles.newButton, pressed && styles.newButtonPressed]}
        onPress={openEditor}
        accessibilityRole="button"
        accessibilityLabel={
          continuing
            ? `Continue the quotation being prepared, ${draftCount} items`
            : 'Make a new quotation'
        }>
        <Ionicons
          name={continuing ? 'arrow-forward-circle' : 'add'}
          size={22}
          color="#FFFFFF"
        />
        <Text style={styles.newButtonText}>
          {continuing ? `Continue quotation · ${draftCount}` : 'New Quotation'}
        </Text>
      </Pressable>
    </View>
  );
}

function QuotationRowItem({
  quotation,
  onShowActions,
}: {
  quotation: QuotationRow;
  onShowActions: (quotation: QuotationRow) => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() =>
        router.push({ pathname: '/quotation/[id]', params: { id: String(quotation.id) } })
      }
      accessibilityRole="button"
      accessibilityLabel={`Quotation ${quotation.reference_number} for ${quotation.customer_name}, ${formatRupees(quotation.grand_total)}. Opens it.`}>
      <View style={styles.rowMain}>
        <Text style={styles.customer} numberOfLines={1}>
          {quotation.customer_name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {quotation.reference_number} · {formatBillDay(quotation.date)}
        </Text>
        <QuotationStatusBadge quotation={quotation} />
      </View>
      <Text style={styles.total}>{formatRupees(quotation.grand_total)}</Text>

      {/* Same overflow affordance as History, for the same reasons: no gesture
          dependency, and acting on a row stays separate from opening it. */}
      <Pressable
        onPress={() => onShowActions(quotation)}
        hitSlop={Spacing.sm}
        style={styles.rowActions}
        accessibilityRole="button"
        accessibilityLabel={`Edit or delete quotation ${quotation.reference_number}`}>
        <Ionicons name="ellipsis-vertical" size={18} color={Colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}

/**
 * "None at all" and "none matching this" are different situations, as on
 * History — the usual reason something cannot be found is a filter left on.
 */
function EmptyState({ search, openOnly }: { search: string; openOnly: boolean }) {
  const filtered = search.trim().length > 0 || openOnly;

  return (
    <View style={styles.empty}>
      <Ionicons name="document-text-outline" size={40} color={Colors.textMuted} />
      <Text style={styles.emptyTitle}>{filtered ? 'Nothing matching' : 'No quotations yet'}</Text>
      <Text style={styles.emptyBody}>
        {filtered
          ? 'Try clearing the search, or the "Not yet converted" filter.'
          : 'A quotation is a price given to a customer before anything is sold. Tap New Quotation to make one.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: { padding: Spacing.md, gap: Spacing.sm },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderRadius: 10,
    backgroundColor: Colors.surface,
  },
  searchInput: { flex: 1, fontSize: FontSizes.body, color: Colors.text },
  filterChip: {
    alignSelf: 'flex-start',
    minHeight: Spacing.minTapTarget - Spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipOn: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  filterChipPressed: { backgroundColor: Colors.surface },
  filterChipText: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.textMuted },
  filterChipTextOn: { color: '#FFFFFF' },
  list: { flex: 1 },
  listContent: { paddingBottom: 96 },
  emptyContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: 96 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surface },
  rowMain: { flex: 1, gap: Spacing.xs },
  rowActions: {
    width: Spacing.minTapTarget - Spacing.md,
    height: Spacing.minTapTarget - Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customer: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  meta: { fontSize: FontSizes.small, color: Colors.textMuted },
  total: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: FontSizes.body, color: Colors.textMuted, textAlign: 'center' },
  errorBanner: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm },

  newButton: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 12,
    backgroundColor: Colors.brand,
  },
  newButtonPressed: { backgroundColor: Colors.brandDark },
  newButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },
});
