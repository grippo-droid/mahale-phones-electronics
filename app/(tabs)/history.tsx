import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { listBills, summariseBills, type SalesSummary } from '@/db/bills';
import type { BillRow } from '@/db/schema';
import { formatBillDay, formatRupees, formatTime } from '@/lib/format';
import { describeRange, RANGE_OPTIONS, resolveRange, type RangeKey } from '@/lib/dateRanges';

/**
 * Bill History (T5.5) — every bill ever raised, searchable and filterable.
 *
 * Until now a bill was only reachable from the Dashboard's last five, so the
 * sixth bill back was effectively lost. This is the screen for when a customer
 * walks in with a complaint and the bill has to be found.
 *
 * Three things here are load-bearing rather than decorative:
 *
 *   - **Bills are paged in.** The shop will accumulate thousands, and there is
 *     no reason to hold them all in memory to show thirty.
 *
 *   - **The count and total cover the whole filter, not the loaded page.**
 *     `summariseBills` runs the same WHERE clause as an aggregate. A total that
 *     climbed as the list was scrolled would be wrong most of the time it was
 *     read.
 *
 *   - **Rows are grouped under the day they fall on.** The day is what the
 *     owner is usually searching by, and a heading says it once instead of
 *     every row repeating it.
 */

/** Enough to fill a phone screen twice over, small enough to feel instant. */
const PAGE_SIZE = 30;

/** Matches the Inventory search — a long list should not re-query per letter. */
const SEARCH_DEBOUNCE_MS = 250;

type Section = { title: string; data: BillRow[] };

export default function HistoryScreen() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<RangeKey>('all');

  const [bills, setBills] = useState<BillRow[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  /**
   * Covers the first load only, and never goes true again.
   *
   * Changing a filter keeps the old list on screen until the new one arrives,
   * rather than blanking it to a spinner. These are local SQLite reads over a
   * few hundred rows, so the wait is milliseconds — putting a spinner over it
   * on every keystroke of a debounced search would be all flicker and no
   * information.
   */
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards against an older query landing after a newer one.
   *
   * Type "ram", then clear it: two queries are in flight and whichever is
   * slower wins. Without this the emptied search box can end up showing
   * Ramesh's bills, which reads as the search being broken.
   */
  const requestId = useRef(0);
  const loadedCount = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadFirstPage = useCallback(async () => {
    const id = ++requestId.current;
    const { from, to } = resolveRange(range);

    try {
      const [rows, totals] = await Promise.all([
        listBills({ search, from, to, limit: PAGE_SIZE, offset: 0 }),
        summariseBills({ search, from, to }),
      ]);
      if (id !== requestId.current) return; // superseded by a newer query

      setBills(rows);
      setSummary(totals);
      loadedCount.current = rows.length;
      setReachedEnd(rows.length < PAGE_SIZE);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [search, range]);

  const loadMore = useCallback(async () => {
    if (loadingMore || reachedEnd || loading) return;

    const id = requestId.current;
    const { from, to } = resolveRange(range);
    setLoadingMore(true);

    try {
      const rows = await listBills({
        search,
        from,
        to,
        limit: PAGE_SIZE,
        offset: loadedCount.current,
      });
      // A filter change while this was in flight has already replaced the list;
      // appending to it now would mix two different searches together.
      if (id !== requestId.current) return;

      setBills((current) => [...current, ...rows]);
      loadedCount.current += rows.length;
      if (rows.length < PAGE_SIZE) setReachedEnd(true);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [search, range, loadingMore, reachedEnd, loading]);

  /**
   * The only thing that starts a load, covering both cases: it runs when the
   * tab is first focused, and again whenever `loadFirstPage` changes identity,
   * which is exactly when the search term or the date range changes.
   *
   * Re-reading on every visit resets paging, which costs someone scrolled deep
   * into last year their place. The far commoner case is raising a bill and
   * coming here to check it saved, and a History screen that does not show the
   * bill just made is the worse of the two failures.
   */
  useFocusEffect(
    useCallback(() => {
      loadFirstPage();
    }, [loadFirstPage])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadFirstPage();
  }, [loadFirstPage]);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setSearch('');
    setRange('all');
  }, []);

  /** Consecutive bills on the same day collapse under one heading. */
  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    let current: Section | null = null;

    for (const bill of bills) {
      const title = formatBillDay(bill.date);
      if (!current || current.title !== title) {
        current = { title, data: [] };
        out.push(current);
      }
      current.data.push(bill);
    }
    return out;
  }, [bills]);

  const isFiltered = search.trim() !== '' || range !== 'all';

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search customer, phone or bill number"
          placeholderTextColor={Colors.textMuted}
          value={searchInput}
          onChangeText={setSearchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
        {searchInput.length > 0 ? (
          <Pressable
            onPress={() => setSearchInput('')}
            hitSlop={12}
            accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* The same two layout rules as the category chips: flexGrow 0 so the row
          does not claim vertical space it has no use for, and a wider right
          padding so the last chip does not read as clipped. Not shared with
          CategoryChips — these hold a different kind of value and only look
          alike. */}
      <ScrollView
        horizontal
        style={styles.chipScroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}>
        {RANGE_OPTIONS.map((option) => {
          const active = range === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => setRange(option.key)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Show bills from ${option.label}`}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={Colors.outOfStock} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* What the current filter adds up to. This is why the total covers the
          whole matching set rather than the loaded page: searching a phone
          number to read off what that customer has spent only works if the
          figure counts all their bills, not the first thirty. */}
      {summary && summary.billCount > 0 ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryCount}>
            {summary.billCount} {summary.billCount === 1 ? 'bill' : 'bills'} {describeRange(range)}
          </Text>
          <Text style={styles.summaryTotal}>{formatRupees(summary.total)}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.brand} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          contentContainerStyle={sections.length === 0 ? styles.emptyContent : styles.listContent}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) => (
            <Text style={styles.dayHeading}>{section.title}</Text>
          )}
          renderItem={({ item }) => <BillRowItem bill={item} />}
          ListEmptyComponent={
            <EmptyState search={search} range={range} onClearFilters={clearFilters} />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={styles.footerSpinner} color={Colors.brand} />
            ) : reachedEnd && bills.length >= PAGE_SIZE ? (
              <Text style={styles.footerEnd}>
                That is every bill{isFiltered ? ' that matches' : ''}.
              </Text>
            ) : null
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          initialNumToRender={12}
          windowSize={11}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------

/**
 * One bill. Tapping it opens the Bill Result screen, where it can be re-shared
 * or re-printed — the same route the Dashboard's recent list already uses.
 *
 * The date is not repeated on the row: the day heading above carries it, so the
 * row shows the time, which is what tells two bills on the same day apart.
 */
function BillRowItem({ bill }: { bill: BillRow }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.billRow, pressed && styles.billRowPressed]}
      onPress={() => router.push({ pathname: '/bill/[id]', params: { id: String(bill.id) } })}
      accessibilityRole="button"
      accessibilityLabel={`Bill ${bill.invoice_number} for ${bill.customer_name}, ${formatRupees(bill.grand_total)}. Opens the bill.`}>
      <View style={styles.billMain}>
        <Text style={styles.billCustomer} numberOfLines={1}>
          {bill.customer_name}
        </Text>
        <Text style={styles.billMeta} numberOfLines={1}>
          {bill.invoice_number} · {formatTime(bill.date)}
        </Text>
      </View>
      <Text style={styles.billTotal}>{formatRupees(bill.grand_total)}</Text>
      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

/**
 * "No bills at all" and "no bills matching this" are different situations and
 * get different words. The filtered one names what is in force, because the
 * usual reason a bill cannot be found is a filter left on from last time — and
 * it offers the single tap that clears them.
 */
function EmptyState({
  search,
  range,
  onClearFilters,
}: {
  search: string;
  range: RangeKey;
  onClearFilters: () => void;
}) {
  const trimmed = search.trim();
  const isFiltered = trimmed !== '' || range !== 'all';

  if (!isFiltered) {
    return (
      <View style={styles.centered}>
        <Ionicons name="receipt-outline" size={48} color={Colors.border} />
        <Text style={styles.emptyTitle}>No bills yet</Text>
        <Text style={styles.emptyBody}>
          Bills appear here as soon as you make them on the Billing tab.
        </Text>
      </View>
    );
  }

  // Reads as one sentence, e.g. No bills matching "9876" in July 2026
  const qualifiers = [
    trimmed !== '' ? `matching "${trimmed}"` : null,
    range !== 'all' ? describeRange(range) : null,
  ].filter(Boolean);

  return (
    <View style={styles.centered}>
      <Ionicons name="search" size={48} color={Colors.border} />
      <Text style={styles.emptyTitle}>No bills {qualifiers.join(' ')}</Text>
      <Text style={styles.emptyBody}>Try a different date range, or a shorter search.</Text>
      <Pressable
        onPress={onClearFilters}
        style={styles.clearFiltersButton}
        accessibilityRole="button"
        accessibilityLabel="Clear the search and date filter, and show every bill">
        <Ionicons name="close-circle-outline" size={18} color={Colors.brand} />
        <Text style={styles.clearFiltersText}>Show all bills</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    margin: Spacing.md,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: Spacing.minTapTarget,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSizes.body,
    color: Colors.text,
    paddingVertical: Spacing.sm,
  },

  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chipRow: {
    gap: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  chip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget - 8,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  chipText: { fontSize: FontSizes.small, color: Colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 8,
    backgroundColor: '#FDECEA',
  },
  errorText: { flex: 1, fontSize: FontSizes.small, color: Colors.outOfStock },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
    backgroundColor: Colors.surface,
  },
  summaryCount: { flex: 1, fontSize: FontSizes.small, color: Colors.textMuted },
  summaryTotal: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },

  // A list in a flex column needs flex: 1 or it sizes to its content and
  // overflows the column — the same rule as the Billing screen's lists.
  list: { flex: 1 },
  listContent: { paddingBottom: Spacing.xl },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },

  dayHeading: {
    fontSize: FontSizes.small,
    fontWeight: '700',
    color: Colors.textMuted,
    // Opaque: the heading sticks, and a transparent one would let rows scroll
    // through the text behind it.
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },

  billRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  billRowPressed: { backgroundColor: Colors.surface },
  billMain: { flex: 1, gap: 2 },
  billCustomer: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  billMeta: { fontSize: FontSizes.small, color: Colors.textMuted },
  billTotal: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },

  footerSpinner: { paddingVertical: Spacing.md },
  footerEnd: {
    fontSize: FontSizes.small,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing.md,
  },

  centered: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyTitle: {
    fontSize: FontSizes.title,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  emptyBody: { fontSize: FontSizes.body, color: Colors.textMuted, textAlign: 'center' },
  clearFiltersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.brand,
  },
  clearFiltersText: { fontSize: FontSizes.body, color: Colors.brand, fontWeight: '600' },
});
