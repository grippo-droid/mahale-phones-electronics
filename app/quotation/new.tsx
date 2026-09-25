import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import ErrorBanner from '@/components/ErrorBanner';
import CategoryChips from '@/components/CategoryChips';
import ContactSuggestions, { useContactSuggestions } from '@/components/ContactSuggestions';
import ProductPickRow from '@/components/ProductPickRow';
import QuantityPrompt from '@/components/QuantityPrompt';
import QuotationItemRow from '@/components/QuotationItemRow';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { listProducts, listUsedCategories, type Product } from '@/db/products';
import { createQuotation, editQuotation } from '@/db/quotations';
import { ALL_CATEGORIES, buildCategoryFilters } from '@/lib/categories';
import { formatRupees } from '@/lib/format';
import { calculateBill } from '@/lib/gst';
import { buildNewQuotation } from '@/lib/quotationDraft';
import { peekQuotationNumber } from '@/lib/quotationNumber';
import { showToast } from '@/store/toast';
import { useNewProductStore } from '@/store/newProduct';
import { deleteQuotationPdf } from '@/lib/quotationPdf';
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

  /** A product created from the "not found" button, waiting on a quantity (T9.4). */
  const [askingQty, setAskingQty] = useState<Product | null>(null);
  const takeNewProduct = useNewProductStore((state) => state.take);

  /** Drops a slower earlier search reply when a newer one has been asked for. */
  const resultsRequestId = useRef(0);

  const lines = useQuotationStore(selectQuotationLines);
  const itemCount = useQuotationStore(selectQuotationItemCount);
  const customer = useQuotationStore(selectQuotationCustomer);
  const addProduct = useQuotationStore((state) => state.addProduct);
  const setQty = useQuotationStore((state) => state.setQty);
  const changeQty = useQuotationStore((state) => state.changeQty);
  const setUnit = useQuotationStore((state) => state.setUnit);
  const setDiscount = useQuotationStore((state) => state.setDiscount);
  const removeLine = useQuotationStore((state) => state.removeLine);
  const setCustomerField = useQuotationStore((state) => state.setCustomerField);
  const clear = useQuotationStore((state) => state.clear);
  const editingQuotationId = useQuotationStore((state) => state.editingQuotationId);

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

  /**
   * The product list shown while browsing.
   *
   * A callback rather than only an effect body so the focus handler can run it
   * too — the same gap Billing had: a chip left selected while a product was
   * added elsewhere showed a list that no longer matched inventory, because
   * none of the effect's dependencies had changed.
   *
   * A request id rather than a per-effect `cancelled` flag, now that two
   * callers can start one.
   */
  const loadResults = useCallback(async () => {
    if (!browsing) return;

    const id = ++resultsRequestId.current;
    setSearching(true);
    try {
      const rows = await listProducts({
        search: hasSearchTerm ? debouncedSearch : undefined,
        category: hasCategory ? category : undefined,
        limit: SEARCH_RESULT_LIMIT,
      });
      if (id === resultsRequestId.current) setResults(rows);
    } catch (err) {
      if (id === resultsRequestId.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (id === resultsRequestId.current) setSearching(false);
    }
  }, [browsing, hasSearchTerm, hasCategory, debouncedSearch, category]);

  /**
   * The only thing that runs it. `useFocusEffect` re-runs whenever its
   * callback changes while the screen is focused, so every keystroke and chip
   * goes through here — a plain effect on the same callback was a second
   * identical query for each of them, not a safety net.
   *
   * Being on focus also means returning from anywhere that could have changed
   * the catalogue re-reads it. The chip list is refreshed with it: a product
   * saved under a category not previously in use adds a chip.
   */
  useFocusEffect(
    useCallback(() => {
      loadResults();
      listUsedCategories()
        .then(setUsedCategories)
        .catch(() => {
          // The fixed list still renders without this.
        });

      // A product created on a trip to the Add Product form. `take` clears it
      // as it hands it over, so it cannot be collected twice or land on a
      // different quotation later. Extended here rather than given a second
      // focus effect, for the reason there is only one loader per screen.
      const handed = takeNewProduct('quotation');
      if (handed) setAskingQty(handed);
    }, [loadResults, takeNewProduct])
  );

  /**
   * Opens the real Add Product form, carrying what was typed.
   *
   * The quotation survives the trip: its lines and customer live in the
   * quotation store, and this screen stays mounted underneath the pushed form.
   */
  const addMissingProduct = useCallback(() => {
    router.push({
      pathname: '/inventory/add',
      params: { addTo: 'quotation', name: debouncedSearch.trim() },
    });
  }, [debouncedSearch]);

  const addAtQty = useCallback(
    (product: Product, qty: number) => {
      addProduct(product);
      setQty(product.id, qty);
      setAskingQty(null);
      // The search that found nothing would now hide the line just added.
      setSearchInput('');
      setDebouncedSearch('');
    },
    [addProduct, setQty]
  );

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

  // The same address-book type-ahead as the billing screen, filling the name
  // and the number together. See components/ContactSuggestions.tsx.
  const contacts = useContactSuggestions(customer.name);

  // Both optional (T9.5), matching a bill. A quotation is an offer; refusing to
  // write one down because the customer has not given a name helps nobody.
  const nameError = null;
  const phoneError = null;
  const canSave = lines.length > 0;

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
      const draft = buildNewQuotation({ lines, customer });

      // Two ways in, one screen: a new quotation takes the next reference, an
      // edit saves over the existing one and keeps its own. Nothing else about
      // the flow differs, which is why the editor is not a second screen.
      const quotation =
        editingQuotationId !== null
          ? await editQuotation(editingQuotationId, draft)
          : await createQuotation(draft);

      // The stored PDF holds the pre-edit figures under the same reference.
      if (editingQuotationId !== null) deleteQuotationPdf(quotation.reference_number);

      showToast(
        editingQuotationId !== null
          ? 'Changes saved'
          : `Quotation saved — ${quotation.reference_number}`
      );

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
  }, [canSave, lines, customer, editingQuotationId, clear]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          title:
            editingQuotationId !== null
              ? 'Edit Quotation'
              : nextReference
                ? `New Quotation ${nextReference}`
                : 'New Quotation',
        }}
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

      <ErrorBanner message={error} style={styles.errorBanner} />

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

                {/* Only with a term typed: that text is what names the new
                    product, and a blank form is no better than the Inventory
                    tab. Same rule as Billing's. */}
                {debouncedSearch.trim() ? (
                  <Pressable
                    style={({ pressed }) => [styles.addMissing, pressed && styles.addMissingPressed]}
                    onPress={addMissingProduct}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${debouncedSearch.trim()} to Inventory and put it on this quotation`}>
                    <Ionicons name="add-circle-outline" size={18} color={Colors.brand} />
                    <Text style={styles.addMissingText} numberOfLines={2}>
                      Add “{debouncedSearch.trim()}” to Inventory
                    </Text>
                  </Pressable>
                ) : null}
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
                onChangeDiscount={setDiscount}
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
            <ContactSuggestions
              state={contacts}
              onPick={(suggestion) => {
                setCustomerField('name', suggestion.name);
                setCustomerField('phone', suggestion.phone);
              }}
            />

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
              <Text style={styles.saveButtonText}>
              {editingQuotationId !== null ? 'Save changes' : 'Save Quotation'}
            </Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {/* Asked once, after returning from the Add Product form. */}
      <QuantityPrompt
        product={askingQty}
        target="quotation"
        onCancel={() => setAskingQty(null)}
        onConfirm={addAtQty}
      />
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
  addMissing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.brand,
  },
  addMissingPressed: { backgroundColor: Colors.brandTint },
  addMissingText: { flex: 1, fontSize: FontSizes.body, fontWeight: '700', color: Colors.brand },
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
  errorBanner: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm },
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
