import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import CategoryChips from '@/components/CategoryChips';
import ProductPickRow from '@/components/ProductPickRow';
import QuotationItemRow from '@/components/QuotationItemRow';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { listProducts, listUsedCategories, type Product } from '@/db/products';
import { createQuotation } from '@/db/quotations';
import { ALL_CATEGORIES, buildCategoryFilters } from '@/lib/categories';
import { formatRupees } from '@/lib/format';
import { calculateBill } from '@/lib/gst';
import { buildNewQuotation } from '@/lib/quotationDraft';
import { peekQuotationNumber } from '@/lib/quotationNumber';
import { getDatabase } from '@/db/init';
import {
  selectQuotationCustomer,
  selectQuotationItemCount,
  selectQuotationLines,
  useQuotationStore,
} from '@/store/quotation';

/**
 * Making a quotation (T5.7).
 *
 * Built alongside the Billing screen rather than out of it. They look alike —
 * search, pick, set a quantity and a unit — but billing carries a great deal
 * this does not need: live stock, oversell warnings, deleted-product prompts,
 * a customer's state and GSTIN, a supply type, a two-step switch. Threading a
 * "quotation mode" through all of that would put the shop's most important
 * screen at risk to save a few hundred lines here.
 *
 * What is genuinely shared is shared: the product row, the category chips, the
 * cart line's shape, the unit list, the GST maths and the document chrome.
 *
 * There is one step, not two. A quotation is usually made while the customer is
 * standing there asking "what would this come to?", so the name and phone sit
 * at the bottom of the same screen as the items.
 */

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_RESULT_LIMIT = 40;

export default function NewQuotationScreen() {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [usedCategories, setUsedCategories] = useState<string[]>([]);
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [nextReference, setNextReference] = useState<string | null>(null);

  const lines = useQuotationStore(selectQuotationLines);
  const itemCount = useQuotationStore(selectQuotationItemCount);
  const customer = useQuotationStore(selectQuotationCustomer);
  const addProduct = useQuotationStore((state) => state.addProduct);
  const setQty = useQuotationStore((state) => state.setQty);
  const changeQty = useQuotationStore((state) => state.changeQty);
  const setUnit = useQuotationStore((state) => state.setUnit);
  const removeLine = useQuotationStore((state) => state.removeLine);
  const setCustomerField = useQuotationStore((state) => state.setCustomerField);
  const clear = useQuotationStore((state) => state.clear);

  const hasSearchTerm = debouncedSearch.trim().length > 0;
  const hasCategory = category !== ALL_CATEGORIES;
  const browsing = hasSearchTerm || hasCategory;

  const categoryChips = useMemo(() => buildCategoryFilters(usedCategories), [usedCategories]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [categories, reference] = await Promise.all([
          listUsedCategories(),
          peekQuotationNumber(getDatabase()),
        ]);
        if (cancelled) return;
        setUsedCategories(categories);
        // Shown, not reserved. The reference is taken inside the write
        // transaction, so this is only a preview and may move if another
        // quotation is saved first.
        setNextReference(reference);
      } catch {
        // Neither is needed to make a quotation; failing quietly is right.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Nothing to fetch when not browsing. The list below reads `shown`, which
    // is empty in that case anyway, so there is no stale state to clear here.
    if (!browsing) return;

    let cancelled = false;
    (async () => {
      // Set inside the async work rather than in the effect body: it belongs to
      // the fetch, and updating state synchronously as an effect runs is the
      // cascading-render pattern React warns about.
      setSearching(true);
      try {
        const rows = await listProducts({
          search: hasSearchTerm ? debouncedSearch : undefined,
          category: hasCategory ? category : undefined,
          limit: SEARCH_RESULT_LIMIT,
        });
        if (!cancelled) setResults(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [browsing, hasSearchTerm, hasCategory, debouncedSearch, category]);

  // Derived rather than cleared in the effect above: "not browsing" always
  // means "no results", so it does not need to be a separate piece of state
  // kept in step.
  const shown = browsing ? results : [];

  const inCart = useMemo(
    () => new Map(lines.map((line) => [line.productId, line.qty])),
    [lines]
  );

  /**
   * The running total, computed the same way the stored quotation will be —
   * as an inter-state supply, which is the exact route to a single GST figure.
   * See the note in `lib/quotationDraft.ts`.
   */
  const totals = useMemo(
    () =>
      calculateBill(
        lines.map((line) => ({
          unitPrice: line.unitPrice,
          qty: line.qty,
          gstRate: line.gstRate,
          priceIncludesGst: line.priceIncludesGst,
        })),
        'inter-state',
        { roundToNearestRupee: true }
      ).totals,
    [lines]
  );

  const nameError = customer.name.trim().length === 0 ? 'A name is needed.' : null;
  const phoneError = customer.phone.trim().length === 0 ? 'A phone number is needed.' : null;
  const canSave = lines.length > 0 && !nameError && !phoneError;

  const backToItems = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setCategory(ALL_CATEGORIES);
  }, []);

  const save = useCallback(async () => {
    if (!canSave) {
      setShowErrors(true);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const quotation = await createQuotation(buildNewQuotation({ lines, customer }));
      // Only cleared once it is safely written, so a failure leaves the
      // quotation on screen to retry rather than retyped.
      clear();
      router.replace({ pathname: '/quotation/[id]', params: { id: String(quotation.id) } });
    } catch (err) {
      setError(
        err instanceof Error
          ? `The quotation could not be saved: ${err.message}`
          : 'The quotation could not be saved.'
      );
    } finally {
      setSaving(false);
    }
  }, [canSave, lines, customer, clear]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{ title: nextReference ? `New Quotation ${nextReference}` : 'New Quotation' }}
      />

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search products"
            placeholderTextColor={Colors.textMuted}
          />
          {searchInput.length > 0 ? (
            <Pressable onPress={() => setSearchInput('')} hitSlop={Spacing.sm}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <CategoryChips
        chips={categoryChips}
        selected={category}
        onSelect={setCategory}
        allLabel="All products"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {browsing ? (
        <FlatList
          data={shown}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ProductPickRow product={item} qtyInCart={inCart.get(item.id)} onAdd={addProduct} />
          )}
          ListHeaderComponent={
            searching ? <ActivityIndicator style={styles.searchSpinner} color={Colors.brand} /> : null
          }
          ListEmptyComponent={
            searching ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nothing found</Text>
                <Text style={styles.emptyBody}>Try a different search or category.</Text>
              </View>
            )
          }
          ListFooterComponent={
            <Pressable style={styles.backLink} onPress={backToItems}>
              <Ionicons name="arrow-back" size={16} color={Colors.brand} />
              <Text style={styles.backLinkText}>Back to the quotation</Text>
            </Pressable>
          }
        />
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled">
          {lines.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Nothing on this quotation yet</Text>
              <Text style={styles.emptyBody}>
                Search above, or pick a category, to add what the customer asked about.
              </Text>
            </View>
          ) : (
            lines.map((line) => (
              <QuotationItemRow
                key={line.productId}
                line={line}
                onChangeQty={setQty}
                onStep={changeQty}
                onChangeUnit={setUnit}
                onRemove={removeLine}
              />
            ))
          )}

          <View style={styles.customerCard}>
            <Text style={styles.cardHeading}>Customer</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={[styles.input, showErrors && nameError ? styles.inputError : null]}
              value={customer.name}
              onChangeText={(value) => setCustomerField('name', value)}
              placeholder="Who is this quotation for?"
              placeholderTextColor={Colors.textMuted}
            />
            {showErrors && nameError ? <Text style={styles.fieldError}>{nameError}</Text> : null}

            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={[styles.input, showErrors && phoneError ? styles.inputError : null]}
              value={customer.phone}
              onChangeText={(value) => setCustomerField('phone', value)}
              placeholder="10-digit number"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
            />
            {showErrors && phoneError ? <Text style={styles.fieldError}>{phoneError}</Text> : null}

            <Text style={styles.label}>Address (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={customer.address}
              onChangeText={(value) => setCustomerField('address', value)}
              placeholder="Printed on the quotation"
              placeholderTextColor={Colors.textMuted}
              multiline
            />

            {/* No GSTIN and no state. Neither means anything on an offer: the
                tax heads are decided when the sale actually happens. */}
            <Text style={styles.hint}>
              The GST split is set on the invoice, when the sale happens. This shows one GST figure.
            </Text>
          </View>
        </ScrollView>
      )}

      {lines.length > 0 && !browsing ? (
        <View style={styles.bar}>
          <View style={styles.barLeft}>
            <Text style={styles.barCount}>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </Text>
            <Text style={styles.barTotal}>{formatRupees(totals.grandTotal)}</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.saveButton, pressed && styles.saveButtonPressed]}
            onPress={save}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save this quotation">
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>Save Quotation</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  searchRow: { padding: Spacing.md, paddingBottom: Spacing.sm },
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
  list: { flex: 1 },
  listContent: { paddingBottom: 120 },
  searchSpinner: { marginVertical: Spacing.md },
  empty: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyBody: { fontSize: FontSizes.body, color: Colors.textMuted, textAlign: 'center' },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  backLinkText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.brand },
  customerCard: {
    margin: Spacing.md,
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.xs,
  },
  cardHeading: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  label: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.textMuted, marginTop: Spacing.sm },
  input: {
    minHeight: Spacing.minTapTarget,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: Spacing.md,
    fontSize: FontSizes.body,
    color: Colors.text,
  },
  inputMultiline: { minHeight: Spacing.minTapTarget * 1.5, textAlignVertical: 'top', paddingTop: Spacing.sm },
  inputError: { borderColor: Colors.outOfStock },
  fieldError: { fontSize: FontSizes.small, color: Colors.outOfStock },
  hint: { fontSize: FontSizes.small, color: Colors.textMuted, marginTop: Spacing.sm },
  error: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    color: Colors.outOfStock,
    fontSize: FontSizes.small,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  barLeft: { flex: 1 },
  barCount: { fontSize: FontSizes.small, color: Colors.textMuted },
  barTotal: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  saveButton: {
    minHeight: Spacing.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: 12,
    backgroundColor: Colors.brand,
  },
  saveButtonPressed: { backgroundColor: Colors.brandDark },
  saveButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },
});
