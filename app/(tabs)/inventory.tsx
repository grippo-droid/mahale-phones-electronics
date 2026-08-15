import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import ProductCard from '@/components/ProductCard';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { listProducts, listUsedCategories, type Product } from '@/db/products';
import { PRODUCT_CATEGORIES } from '@/db/schema';

/**
 * Inventory list (T2.1) with stock-state highlighting (T2.2).
 *
 * Accepts a `filter=low` route param so the Dashboard's low-stock banner can
 * open this screen already filtered (T5.4).
 */

const ALL = 'All';

/** Keystrokes are debounced so a long product list is not re-queried per letter. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Filter chips = the fixed category list, plus any category actually present in
 * the database that is not on that list.
 *
 * Adding a product uses the fixed dropdown only. But filtering must cover what
 * is really stored, otherwise products in a retired or renamed category become
 * unreachable from this screen — invisible under every chip including the one
 * they belong to. That can happen after the category list is edited (as it was
 * when "Wiring & Electrical" was introduced) or after restoring an old backup.
 */
function buildFilterChips(usedCategories: string[]): string[] {
  const fixed = [...PRODUCT_CATEGORIES] as string[];
  const orphans = usedCategories.filter((category) => !fixed.includes(category));
  return [ALL, ...fixed, ...orphans];
}

export default function InventoryScreen() {
  const params = useLocalSearchParams<{ filter?: string }>();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState<string>(ALL);
  const [lowStockOnly, setLowStockOnly] = useState(params.filter === 'low');
  const [products, setProducts] = useState<Product[]>([]);
  const [usedCategories, setUsedCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterChips = useMemo(() => buildFilterChips(usedCategories), [usedCategories]);

  // Respond to the Dashboard opening this screen pre-filtered.
  useEffect(() => {
    setLowStockOnly(params.filter === 'low');
  }, [params.filter]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [rows, categories] = await Promise.all([
        listProducts({
          search: debouncedSearch,
          category: category === ALL ? null : category,
          lowStockOnly,
        }),
        listUsedCategories(),
      ]);
      setProducts(rows);
      setUsedCategories(categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, category, lowStockOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload on return from add/edit so a saved change is visible immediately.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setCategory(ALL);
    setLowStockOnly(false);
  }, []);

  const flaggedCount = useMemo(
    () => products.filter((product) => product.stockStatus !== 'ok').length,
    [products]
  );

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search name, brand or HSN code"
          placeholderTextColor={Colors.textMuted}
          value={searchInput}
          onChangeText={setSearchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
        {searchInput.length > 0 ? (
          <Pressable onPress={() => setSearchInput('')} hitSlop={12} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}>
        {filterChips.map((chip) => {
          const active = category === chip;
          return (
            <Pressable
              key={chip}
              onPress={() => setCategory(chip)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={() => setLowStockOnly((value) => !value)}
        style={styles.lowToggle}
        accessibilityRole="button"
        accessibilityState={{ selected: lowStockOnly }}>
        <Ionicons
          name={lowStockOnly ? 'checkbox' : 'square-outline'}
          size={18}
          color={lowStockOnly ? Colors.lowStock : Colors.textMuted}
        />
        <Text style={[styles.lowToggleText, lowStockOnly && styles.lowToggleTextActive]}>
          Needs attention only
        </Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.brand} />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              onPress={(product) =>
                router.push({ pathname: '/inventory/[id]', params: { id: String(product.id) } })
              }
            />
          )}
          ListHeaderComponent={
            products.length > 0 ? (
              <Text style={styles.resultCount}>
                {products.length} {products.length === 1 ? 'product' : 'products'}
                {flaggedCount > 0 ? ` · ${flaggedCount} need attention` : ''}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              search={debouncedSearch}
              category={category}
              lowStockOnly={lowStockOnly}
              onClearFilters={clearFilters}
            />
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={products.length === 0 ? styles.emptyContent : undefined}
          initialNumToRender={12}
          windowSize={11}
        />
      )}

      <Pressable
        style={styles.fab}
        onPress={() => router.push('/inventory/add')}
        accessibilityRole="button"
        accessibilityLabel="Add a new product">
        <Ionicons name="add" size={32} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

/**
 * Empty states. Naming the filters that are actually in force matters here: a
 * bare "no matching products" leaves you unsure whether the shop has no such
 * item or whether a filter you forgot about is hiding it. The full polish pass
 * is T7.1.
 */
function EmptyState({
  search,
  category,
  lowStockOnly,
  onClearFilters,
}: {
  search: string;
  category: string;
  lowStockOnly: boolean;
  onClearFilters: () => void;
}) {
  const trimmedSearch = search.trim();
  const isFiltered = trimmedSearch !== '' || category !== ALL || lowStockOnly;

  if (!isFiltered) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cube-outline" size={48} color={Colors.border} />
        <Text style={styles.emptyTitle}>No products yet</Text>
        <Text style={styles.emptyBody}>Tap the + button to add your first item.</Text>
      </View>
    );
  }

  // Reads as one sentence, e.g.
  // "No products needing attention in Wiring & Electrical matching \"philips\""
  const qualifiers = [
    lowStockOnly ? 'needing attention' : null,
    category !== ALL ? `in ${category}` : null,
    trimmedSearch !== '' ? `matching "${trimmedSearch}"` : null,
  ].filter(Boolean);

  return (
    <View style={styles.centered}>
      <Ionicons name="search" size={48} color={Colors.border} />
      <Text style={styles.emptyTitle}>No products {qualifiers.join(' ')}</Text>
      <Text style={styles.emptyBody}>
        Nothing in your inventory matches these filters.
      </Text>
      <Pressable
        onPress={onClearFilters}
        style={styles.clearFiltersButton}
        accessibilityRole="button"
        accessibilityLabel="Clear all filters and show every product">
        <Ionicons name="close-circle-outline" size={18} color={Colors.brand} />
        <Text style={styles.clearFiltersText}>Show all products</Text>
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
  searchInput: { flex: 1, fontSize: FontSizes.body, color: Colors.text, paddingVertical: Spacing.sm },
  chipRow: { paddingHorizontal: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.sm },
  chip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  chipText: { fontSize: FontSizes.small, color: Colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  lowToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  lowToggleText: { fontSize: FontSizes.small, color: Colors.textMuted, fontWeight: '600' },
  lowToggleTextActive: { color: Colors.lowStock },
  resultCount: {
    fontSize: FontSizes.small,
    color: Colors.textMuted,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  error: { color: Colors.outOfStock, fontSize: FontSizes.body, paddingHorizontal: Spacing.md },
  centered: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
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
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
});
