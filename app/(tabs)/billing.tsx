import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import BillItemRow from '@/components/BillItemRow';
import CategoryChips from '@/components/CategoryChips';
import CustomerDetailsForm from '@/components/CustomerDetailsForm';
import GstSummary from '@/components/GstSummary';
import QuickPickList, { type QuickPickSection } from '@/components/QuickPickList';
import ProductPickRow from '@/components/ProductPickRow';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { createBill, editBill, getBillById } from '@/db/bills';
import { AlreadyConvertedError, convertQuotationToBill } from '@/db/quotations';
import {
  FREQUENTLY_SOLD_WINDOW_DAYS,
  getFrequentlySold,
  getProductsByIds,
  listProducts,
  listUsedCategories,
  type Product,
} from '@/db/products';
import { ALL_CATEGORIES, buildCategoryFilters } from '@/lib/categories';
import { buildNewBill, findDeletedProducts, findOversells } from '@/lib/billDraft';
import { resolveSupplyType, validateCustomer, type CustomerField } from '@/lib/customer';
import { formatRupees } from '@/lib/format';
import { calculateBill, type SupplyType } from '@/lib/gst';
import { PAYMENT_TYPES, type PaymentType } from '@/lib/payment';
import type { BillUnit } from '@/lib/units';
import { invoiceNumberGenerator } from '@/lib/invoiceNumber';
import { deleteBillPdf } from '@/lib/pdf';
import { selectBusinessState, useSettingsStore } from '@/store/settings';
import { showToast } from '@/store/toast';
import {
  selectCustomer,
  selectItemCount,
  selectLines,
  useCartStore,
  type CartLine,
} from '@/store/cart';

/**
 * Billing — items (T3.3) and customer details (T3.4).
 *
 * Frontend Spec 2.4 describes billing as steps. Both steps live on this one
 * screen behind a switch at the top rather than as pushed screens, so moving
 * between them never risks the cart and the tab bar stays available mid-bill:
 * looking up a price on the Inventory tab part-way through a sale is a normal
 * thing to do at a counter, and the cart is in Zustand precisely so that round
 * trip costs nothing.
 *
 * On the items step there are two ways to reach a product: type a search, or
 * tap a category chip (T3.7). Either one puts the screen into browsing mode;
 * clearing both shows the bill again. Browsing by category exists because a
 * counter should not require typing a search for every item — and the chips
 * carry the same list as Inventory, orphaned categories included, or products
 * in a retired category would be unreachable when billing.
 *
 * The running total sits in a bar pinned to the bottom, so what has been added
 * stays visible on both steps.
 *
 * The GST breakdown panel is T3.5 and "Generate Bill" is T3.6. The frequently
 * sold shortcut is T3.8.
 */

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_RESULT_LIMIT = 40;

/** How many products the catalogue fallback shows when nothing has sold yet. */
const CATALOGUE_FALLBACK_LIMIT = 60;

type QuickPick = { sections: QuickPickSection[] };
const EMPTY_QUICK_PICK: QuickPick = { sections: [] };

/**
 * Used only to put a number on screen before the customer's state is known.
 * Most sales are local, so this is the likelier of the two — but see the note on
 * `grandTotal` for why it is a stand-in and not simply the answer.
 */
const PROVISIONAL_SUPPLY_TYPE = 'intra-state' as const;

type Step = 'items' | 'customer';

export default function BillingScreen() {
  const [step, setStep] = useState<Step>('items');
  const [touched, setTouched] = useState<Partial<Record<CustomerField, boolean>>>({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [usedCategories, setUsedCategories] = useState<string[]>([]);
  const [quickPick, setQuickPick] = useState<QuickPick>(EMPTY_QUICK_PICK);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Live stock by product id, refreshed from the database — never from the cart. */
  const [stockById, setStockById] = useState<Record<number, number>>({});

  /** Drops a slower earlier search reply when a newer one has been asked for. */
  const resultsRequestId = useRef(0);

  const lines = useCartStore(selectLines);
  const itemCount = useCartStore(selectItemCount);
  const customer = useCartStore(selectCustomer);
  const businessState = useSettingsStore(selectBusinessState);
  const addProduct = useCartStore((state) => state.addProduct);
  const setQty = useCartStore((state) => state.setQty);
  const changeQty = useCartStore((state) => state.changeQty);
  const setUnit = useCartStore((state) => state.setUnit);
  const paymentType = useCartStore((state) => state.paymentType);
  const paid = useCartStore((state) => state.paid);
  const setPaymentType = useCartStore((state) => state.setPaymentType);
  const setPaid = useCartStore((state) => state.setPaid);
  const sourceQuotationId = useCartStore((state) => state.sourceQuotationId);
  const editingBillId = useCartStore((state) => state.editingBillId);
  const editingOriginalTotal = useCartStore((state) => state.editingOriginalTotal);
  const removeLine = useCartStore((state) => state.removeLine);
  const setCustomerField = useCartStore((state) => state.setCustomerField);
  const clear = useCartStore((state) => state.clear);

  const hasSearchTerm = debouncedSearch.trim().length > 0;
  const hasCategory = category !== ALL_CATEGORIES;
  /** Browsing products, rather than looking at the bill. */
  const browsing = hasSearchTerm || hasCategory;

  const categoryChips = useMemo(
    () => buildCategoryFilters(usedCategories),
    [usedCategories]
  );

  /**
   * What to offer before anything is searched for (T3.8): the frequently sold
   * products, or the catalogue by category when there is no usable history.
   *
   * Loaded on focus rather than on every keystroke — the ranking only moves
   * when a bill is generated, and this screen is where that happens.
   */
  const loadQuickPick = useCallback(async () => {
    try {
      const frequent = await getFrequentlySold();

      if (frequent.source !== 'none') {
        setQuickPick({
          sections: [
            {
              title: 'Frequently sold',
              caption:
                frequent.source === 'recent'
                  ? `Most sold in the last ${FREQUENTLY_SOLD_WINDOW_DAYS} days`
                  : 'Most sold so far — there is not much history yet',
              products: frequent.products,
            },
          ],
        });
        return;
      }

      // Nothing has ever sold. Show the catalogue instead of an empty heading:
      // on a shop's first day the quick list is the whole point of the screen.
      const all = await listProducts({ limit: CATALOGUE_FALLBACK_LIMIT });
      const byCategory = new Map<string, Product[]>();
      for (const product of all) {
        const bucket = byCategory.get(product.category) ?? [];
        bucket.push(product);
        byCategory.set(product.category, bucket);
      }

      const sections = [...byCategory.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([title, products], index) => ({
          title,
          // Said once, on the first section, rather than repeated per category.
          caption: index === 0 ? 'No sales history yet — everything in stock' : null,
          products,
        }));
      setQuickPick({ sections });
    } catch {
      // The search box and the chips still work without this; a failed quick
      // list must not stop a sale.
      setQuickPick(EMPTY_QUICK_PICK);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /**
   * The product list shown while browsing.
   *
   * Pulled out of the effect so the focus handler can run it too. It used to
   * live only in an effect keyed on the search term and the chip, which meant
   * leaving this tab to add a product and coming back with the same chip still
   * selected showed a list that no longer matched inventory — nothing had
   * changed in the dependencies, so nothing re-queried.
   *
   * Guarded by a request id rather than a per-effect `cancelled` flag, because
   * there are now two callers and a slower earlier reply must not overwrite a
   * newer one. Same guard as History's.
   */
  const loadResults = useCallback(async () => {
    if (!browsing) return;

    const id = ++resultsRequestId.current;
    setSearching(true);

    try {
      const rows = await listProducts({
        search: debouncedSearch,
        category: hasCategory ? category : null,
        limit: SEARCH_RESULT_LIMIT,
      });
      if (id !== resultsRequestId.current) return;

      setResults(rows);
      // Search results carry fresh stock, so fold them into the map too.
      setStockById((current) => ({
        ...current,
        ...Object.fromEntries(rows.map((row) => [row.id, row.stock_qty])),
      }));
      setError(null);
    } catch (err) {
      if (id === resultsRequestId.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (id === resultsRequestId.current) setSearching(false);
    }
  }, [debouncedSearch, browsing, hasCategory, category]);

  // No clearing when browsing stops: `showResults` already requires `browsing`,
  // so a stale list is never on screen, and the next browse overwrites it
  // before it could be.
  // Called a microtask later rather than straight from the effect body: the
  // first thing loadResults does is show the spinner, and a synchronous state
  // write while an effect runs is the cascading-render pattern React warns
  // about. A microtask is imperceptible and keeps the effect body clean.
  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) await loadResults();
    })();
    return () => {
      active = false;
    };
  }, [loadResults]);

  const refreshStock = useCallback(async () => {
    const ids = useCartStore.getState().lines.map((line) => line.productId);
    if (ids.length === 0) return;

    try {
      const products = await getProductsByIds(ids);
      const found = new Map(products.map((product) => [product.id, product.stock_qty]));
      // Ids with no row have been deleted since being added; record them as
      // absent so the row can say so rather than showing a stale number.
      setStockById((current) => {
        const next = { ...current };
        for (const id of ids) {
          if (found.has(id)) next[id] = found.get(id)!;
          else delete next[id];
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Stock moves while a bill is open — another sale, or a manual adjustment on
  // the Inventory tab. Re-read it whenever this screen comes back into view,
  // along with the categories actually in use, which change as products are
  // added or edited on that same trip.
  useFocusEffect(
    useCallback(() => {
      refreshStock();
      loadQuickPick();
      // Only does anything while a chip or a search is active; see loadResults.
      loadResults();
      listUsedCategories()
        .then(setUsedCategories)
        .catch(() => {
          // The fixed list still renders without this; an unreachable orphan
          // category is not worth an error message over the bill.
        });
    }, [refreshStock, loadQuickPick, loadResults])
  );

  const inCart = useMemo(
    () => new Map(lines.map((line) => [line.productId, line.qty])),
    [lines]
  );

  /**
   * The place of supply, once it can honestly be decided. Null means the
   * customer's state has not been picked yet (or the shop's own state is still
   * a placeholder), and the figures below are provisional.
   */
  const supplyType = useMemo(
    () => resolveSupplyType(customer.state, businessState),
    [customer.state, businessState]
  );

  /**
   * In exact arithmetic the grand total does not depend on the place of supply:
   * CGST + SGST at half the rate each is the same as IGST at the full rate. It
   * is not exact in practice. CGST and SGST have to come out precisely equal, so
   * each is rounded to paise independently at half the rate — and twice the
   * rounded half is not always the rounded whole. The two routes end up a paisa
   * or two apart, which after rounding to the rupee flips the total by ₹1 on
   * roughly one cart in a hundred.
   *
   * So the real supply type is used as soon as it is known, and only falls back
   * to a stand-in while the state is still blank. The fallback is marked
   * provisional in the summary bar rather than presented as the price.
   */
  const grandTotal = useMemo(
    () =>
      calculateBill(
        lines.map((line) => ({
          unitPrice: line.unitPrice,
          qty: line.qty,
          gstRate: line.gstRate,
          priceIncludesGst: line.priceIncludesGst,
        })),
        supplyType ?? PROVISIONAL_SUPPLY_TYPE,
        { roundToNearestRupee: true }
      ).totals.grandTotal,
    [lines, supplyType]
  );

  /**
   * Items on the bill with no HSN code. Read from the cart line's snapshot
   * rather than re-queried, because the snapshot is what `bill_items` will store
   * and therefore what actually reaches the invoice.
   */
  const missingHsnNames = useMemo(
    () =>
      lines
        .filter((line) => !line.hsnCode || line.hsnCode.trim().length === 0)
        .map((line) => line.name),
    [lines]
  );

  const oversoldCount = useMemo(
    () =>
      lines.filter((line) => {
        const stock = stockById[line.productId];
        return stock !== undefined && stock - line.qty < 0;
      }).length,
    [lines, stockById]
  );

  const handleAdd = useCallback(
    (product: Product) => {
      addProduct(product);
      setStockById((current) => ({ ...current, [product.id]: product.stock_qty }));
    },
    [addProduct]
  );

  const confirmClear = useCallback(() => {
    Alert.alert(
      'Clear this bill?',
      'The items and the customer details will both be removed. Nothing has been saved yet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clear();
            setTouched({});
            setStep('items');
          },
        },
      ]
    );
  }, [clear]);

  const backToBill = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setCategory(ALL_CATEGORIES);
  }, []);

  const handleBlurField = useCallback((field: CustomerField) => {
    setTouched((current) => ({ ...current, [field]: true }));
  }, []);

  const customerValidation = useMemo(
    () => validateCustomer(customer, businessState),
    [customer, businessState]
  );

  // -------------------------------------------------------------------------
  // Generate Bill (T3.6)
  // -------------------------------------------------------------------------

  const writeBill = useCallback(async () => {
    // Re-resolved here rather than trusted from render: this is the value that
    // decides the tax heads on a permanent record.
    const type = resolveSupplyType(customer.state, businessState);
    if (!type) {
      setError('The customer’s state is needed before a bill can be generated.');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      // Non-null by here: handleGenerate refuses to reach this without one.
      const draft = buildNewBill({
        lines,
        customer,
        supplyType: type,
        paymentType: paymentType!,
        paid,
      });
      const payload = {
        ...draft,
        // Reserved inside the write transaction, so a bill that fails to save
        // cannot consume a number — see lib/invoiceNumber.ts.
        generateInvoiceNumber: invoiceNumberGenerator(),
      };

      // Three ways in, one writer. A new sale, a quotation being converted —
      // which marks the quotation inside the same transaction — or an existing
      // bill being edited, which keeps its invoice number and its date and
      // adjusts stock by the difference. Routing all three through this screen
      // is what keeps the customer step, the oversell confirmation and the
      // numbering identical for every bill the shop raises.
      let billId: number;
      if (editingBillId !== null) {
        const edited = await editBill(editingBillId, payload);
        // The stored PDF still holds the pre-edit figures under the same
        // invoice number; leaving it would reshare the wrong document.
        deleteBillPdf(edited.invoice_number);
        billId = edited.id;
      } else if (sourceQuotationId !== null) {
        billId = (await convertQuotationToBill(sourceQuotationId, payload)).billId;
      } else {
        billId = (await createBill(payload)).id;
      }

      // Only cleared once the bill is safely written. If createBill throws, the
      // cart is still there and the sale can be retried rather than retyped.
      clear();
      setTouched({});
      setStep('items');
      setSearchInput('');

      // The bill screen it lands on shows the figures, so this only has to
      // confirm which of the three things just happened.
      showToast(
        editingBillId !== null
          ? 'Changes saved'
          : `Bill saved — ${(await getBillById(billId))?.invoice_number ?? ''}`.trim()
      );

      router.push({ pathname: '/bill/[id]', params: { id: String(billId) } });
    } catch (err) {
      // Its own message: this one is not a failure to save so much as a race
      // already resolved, and the owner needs to know a bill exists rather than
      // that something broke.
      if (err instanceof AlreadyConvertedError) {
        setError(
          'That quotation has already been turned into a bill. Open it from the Quotes tab to see which one.'
        );
        return;
      }

      setError(
        err instanceof Error
          ? `The bill could not be saved: ${err.message}`
          : 'The bill could not be saved.'
      );
    } finally {
      setGenerating(false);
    }
    // businessState is in here because writeBill reads it to resolve the supply
    // type, and that decides the tax heads on a permanent record. Left out, a
    // cart open while the shop's own state is corrected in Settings would be
    // billed against the old value.
  }, [
    customer,
    businessState,
    lines,
    paymentType,
    paid,
    sourceQuotationId,
    editingBillId,
    clear,
  ]);

  const handleGenerate = useCallback(() => {
    // Force every outstanding error into view rather than only the touched ones,
    // so pressing the button on a half-filled form explains itself.
    // Payment type is required, and is reported the same way an incomplete
    // customer is: reveal every outstanding error and go to the step that holds
    // them. The button is never disabled — a greyed-out button that does not say
    // why is the most confusing thing to hand a first-time user.
    if (!customerValidation.canGenerate || paymentType === null) {
      setShowAllErrors(true);
      setStep('customer');
      return;
    }

    const deleted = findDeletedProducts(lines, stockById);
    if (deleted.length > 0) {
      Alert.alert(
        deleted.length === 1 ? 'A product was deleted' : 'Some products were deleted',
        `${deleted.join(', ')} ${deleted.length === 1 ? 'is' : 'are'} no longer in inventory. ` +
          'The bill can still be generated, but there is no stock to reduce. Remove the ' +
          'line instead if it was added by mistake.',
        [
          { text: 'Go back', style: 'cancel' },
          { text: 'Generate anyway', style: 'destructive', onPress: () => confirmOversell() },
        ]
      );
      return;
    }

    confirmOversell();

    /**
     * One consolidated confirmation, at the end, rather than a dialog per line.
     * The per-line warnings have been on screen the whole time and are a
     * statement of fact; this is the single point where the count is actually
     * changed, so it is the one place a decision is being made. A dialog per
     * oversold row would train the user to dismiss dialogs unread.
     */
    function confirmOversell() {
      const oversells = findOversells(lines, stockById);
      if (oversells.length === 0) {
        writeBill();
        return;
      }

      const detail = oversells
        .map((o) => `• ${o.name}: ${o.qty} billed, ${o.stockQty} in stock → ${-o.shortfall}`)
        .join('\n');

      Alert.alert(
        'Stock will go negative',
        `${detail}\n\nThis is allowed — it usually means the recorded count is behind. ` +
          'The bill will be generated and the counts corrected on the Inventory tab.',
        [
          { text: 'Go back', style: 'cancel' },
          { text: 'Generate bill', onPress: () => writeBill() },
        ]
      );
    }
  }, [customerValidation.canGenerate, paymentType, lines, stockById, writeBill]);

  const showResults = step === 'items' && browsing;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StepSwitch step={step} onChange={setStep} customerDone={customerValidation.canGenerate} />

      {step === 'items' ? (
        <>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search products to add"
            placeholderTextColor={Colors.textMuted}
            value={searchInput}
            onChangeText={setSearchInput}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search products to add to the bill"
          />
          {searchInput.length > 0 ? (
            <Pressable
              onPress={() => setSearchInput('')}
              hitSlop={Spacing.sm}
              accessibilityRole="button"
              accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Browsing by category, so the counter does not require typing a
            search for every item. Same chip list as Inventory — including any
            category present in the data but no longer on the fixed list, or
            those products would be unreachable here too. */}
        <CategoryChips
          chips={categoryChips}
          selected={category}
          onSelect={setCategory}
          // On this screen "All" means "stop browsing and show the bill", which
          // is not what it means on Inventory.
          allLabel="Show the bill"
        />
        </>
      ) : null}

      {editingBillId !== null ? (
        <View style={styles.editBanner}>
          <Ionicons name="create-outline" size={16} color={Colors.brand} />
          <Text style={styles.editBannerText}>
            Editing a saved bill. It keeps its invoice number and its original date.
          </Text>
        </View>
      ) : null}

      {/* A bill marked Paid whose total has gone up is claiming money that may
          not have arrived. Said here rather than blocking the save: the owner
          may well have taken the difference in cash. */}
      {editingBillId !== null && paid && editingOriginalTotal !== null
      && grandTotal > editingOriginalTotal ? (
        <View style={styles.editWarning}>
          <Ionicons name="warning" size={16} color={Colors.lowStock} />
          <Text style={styles.editWarningText}>
            This bill is marked Paid but the total has gone up by{' '}
            {formatRupees(grandTotal - editingOriginalTotal)}. Check whether the rest has
            been received.
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {step === 'customer' ? (
        <ScrollView
          style={styles.customerScroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.customerScrollContent}>
          <CustomerDetailsForm
            customer={customer}
            onChangeField={setCustomerField}
            touched={touched}
            onBlurField={handleBlurField}
            businessState={businessState}
            showAllErrors={showAllErrors}
          />

          <PaymentPicker
            paymentType={paymentType}
            paid={paid}
            onChangeType={setPaymentType}
            onChangePaid={setPaid}
            showError={showAllErrors && paymentType === null}
          />

          <GstSummary
            lines={lines}
            supplyType={supplyType}
            missingHsnNames={missingHsnNames}
          />
        </ScrollView>
      ) : showResults ? (
        <SearchResults
          results={results}
          searching={searching}
          inCart={inCart}
          onAdd={handleAdd}
          term={debouncedSearch}
          category={hasCategory ? category : null}
          onReset={backToBill}
        />
      ) : (
        <Cart
          lines={lines}
          stockById={stockById}
          supplyType={supplyType ?? PROVISIONAL_SUPPLY_TYPE}
          quickPick={quickPick}
          inCart={inCart}
          onAdd={handleAdd}
          onChangeQty={setQty}
          onStep={changeQty}
          onChangeUnit={setUnit}
          onRemove={removeLine}
        />
      )}

      {lines.length > 0 ? (
        <View style={styles.summaryBar}>
          <View style={styles.summaryLeft}>
            <Text style={styles.summaryCount}>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
              {lines.length !== itemCount ? ` · ${lines.length} lines` : ''}
            </Text>
            {oversoldCount > 0 ? (
              <Text style={styles.summaryWarning}>
                {oversoldCount} {oversoldCount === 1 ? 'item goes' : 'items go'} below zero stock
              </Text>
            ) : null}
          </View>

          <View style={styles.summaryRight}>
            <Text style={styles.summaryTotal}>{formatRupees(grandTotal)}</Text>
            {/* Honest about the one rupee: without the state this can land a
                rupee either side of the final figure. */}
            {supplyType === null ? (
              <Text style={styles.provisionalNote}>approx. until state is set</Text>
            ) : null}
            <Pressable
              onPress={confirmClear}
              hitSlop={Spacing.sm}
              accessibilityRole="button"
              accessibilityLabel="Clear this bill">
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Moving on is only offered once there is something to bill — a customer
          form filled in for an empty bill would have nothing to attach to. */}
      {step === 'items' && lines.length > 0 && !showResults ? (
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
          onPress={() => setStep('customer')}
          accessibilityRole="button"
          accessibilityLabel="Continue to customer details">
          <Text style={styles.primaryButtonText}>Next: customer details</Text>
          <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
        </Pressable>
      ) : null}

      {/* The button stays enabled on an incomplete form and explains what is
          missing when pressed. A greyed-out button with no reason given is the
          single most confusing thing to hand a first-time user. */}
      {step === 'customer' && lines.length > 0 ? (
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            generating && styles.primaryButtonBusy,
          ]}
          onPress={handleGenerate}
          disabled={generating}
          accessibilityRole="button"
          accessibilityState={{ disabled: generating }}
          accessibilityLabel={editingBillId !== null ? 'Save the changes' : 'Generate the bill'}>
          {generating ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Ionicons
              name={editingBillId !== null ? 'save' : 'receipt'}
              size={20}
              color="#FFFFFF"
            />
          )}
          <Text style={styles.primaryButtonText}>
            {generating ? 'Saving…' : editingBillId !== null ? 'Save changes' : 'Generate bill'}
          </Text>
        </Pressable>
      ) : null}

      {/* One way back to the bill, whichever way the browsing started — a
          typed search, a category chip, or both. Leaving the user to work out
          that they must clear two separate things would be needless. */}
      {showResults && lines.length > 0 ? (
        <Pressable
          style={styles.viewCartHint}
          onPress={backToBill}
          accessibilityRole="button"
          accessibilityLabel="Back to the bill">
          <Text style={styles.viewCartHintText}>Back to the bill</Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------

/**
 * How the sale is being settled (T5.6).
 *
 * On the customer step rather than the items step: it is a fact about the deal
 * being struck with this person, like their name and their state, not about
 * what is on the bill. It also has to be seen before "Generate Bill", and this
 * is the step that button lives on.
 *
 * The paid row appears only once a type is chosen, because until then there is
 * nothing for it to default from and a status with no payment type behind it is
 * a half-answered question.
 */
type PaymentPickerProps = {
  paymentType: PaymentType | null;
  paid: boolean;
  onChangeType: (type: PaymentType) => void;
  onChangePaid: (paid: boolean) => void;
  showError: boolean;
};

function PaymentPicker({
  paymentType,
  paid,
  onChangeType,
  onChangePaid,
  showError,
}: PaymentPickerProps) {
  return (
    <View style={styles.paymentCard}>
      <Text style={styles.paymentHeading}>Payment</Text>

      <View style={styles.paymentRow}>
        {PAYMENT_TYPES.map((type) => {
          const selected = paymentType === type;
          return (
            <Pressable
              key={type}
              onPress={() => onChangeType(type)}
              style={({ pressed }) => [
                styles.paymentOption,
                selected && styles.paymentOptionSelected,
                pressed && styles.paymentOptionPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={
                type === 'Cash' ? 'Cash sale, paid now' : 'Credit sale, to be paid later'
              }>
              <Text style={[styles.paymentOptionText, selected && styles.paymentOptionTextSelected]}>
                {type}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {showError ? (
        <Text style={styles.paymentError}>Choose Cash or Credit before generating the bill.</Text>
      ) : null}

      {paymentType !== null ? (
        <>
          <View style={styles.paymentRow}>
            <Pressable
              onPress={() => onChangePaid(true)}
              style={({ pressed }) => [
                styles.paymentOption,
                paid && styles.paidOptionSelected,
                pressed && styles.paymentOptionPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: paid }}
              accessibilityLabel="The money has been received">
              <Text style={[styles.paymentOptionText, paid && styles.paymentOptionTextSelected]}>
                Paid
              </Text>
            </Pressable>

            <Pressable
              onPress={() => onChangePaid(false)}
              style={({ pressed }) => [
                styles.paymentOption,
                !paid && styles.unpaidOptionSelected,
                pressed && styles.paymentOptionPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: !paid }}
              accessibilityLabel="The money has not been received yet">
              <Text style={[styles.paymentOptionText, !paid && styles.paymentOptionTextSelected]}>
                Not Paid
              </Text>
            </Pressable>
          </View>

          {/* Says that the status is not welded to the type, because the
              default makes it look as though it might be. */}
          <Text style={styles.paymentHint}>
            {paymentType === 'Cash'
              ? 'Cash sales start as paid. Change it if the money has not come in yet.'
              : 'Credit sales start as not paid. This can be changed later from History.'}
          </Text>
        </>
      ) : null}
    </View>
  );
}

type StepSwitchProps = {
  step: Step;
  onChange: (step: Step) => void;
  customerDone: boolean;
};

/**
 * Both steps are reachable at any time rather than the second being unlocked by
 * the first. A customer often gives their name before the last item is scanned,
 * and forcing an order onto that would mean going back and forth.
 */
function StepSwitch({ step, onChange, customerDone }: StepSwitchProps) {
  return (
    <View style={styles.stepSwitch}>
      {(['items', 'customer'] as const).map((value) => {
        const active = step === value;
        return (
          <Pressable
            key={value}
            style={[styles.stepTab, active && styles.stepTabActive]}
            onPress={() => onChange(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={value === 'items' ? 'Items step' : 'Customer details step'}>
            <Text style={[styles.stepTabText, active && styles.stepTabTextActive]}>
              {value === 'items' ? '1. Items' : '2. Customer'}
            </Text>
            {value === 'customer' && customerDone ? (
              <Ionicons name="checkmark-circle" size={16} color={Colors.inStock} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------

type SearchResultsProps = {
  results: Product[];
  searching: boolean;
  inCart: Map<number, number>;
  onAdd: (product: Product) => void;
  term: string;
  /** The category being browsed, or null when only a search is in force. */
  category: string | null;
  onReset: () => void;
};

function SearchResults({ results, searching, inCart, onAdd, term, category, onReset }: SearchResultsProps) {
  if (searching && results.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="search" size={40} color={Colors.border} />
        <Text style={styles.emptyTitle}>
          {term.trim() && category
            ? `No ${category} product matches “${term.trim()}”`
            : term.trim()
              ? `Nothing matches “${term.trim()}”`
              : `No products in ${category}`}
        </Text>
        <Text style={styles.emptyBody}>
          {term.trim()
            ? 'Try part of the name, brand, model number or HSN code.'
            : 'Add one on the Inventory tab, or pick another category.'}
        </Text>
        <Pressable onPress={onReset} accessibilityRole="button">
          <Text style={styles.viewCartHintText}>Back to the bill</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={results}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyExtractor={(product) => String(product.id)}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        // The same row the quick-pick list uses: tapping a search result and
        // tapping a frequently-sold product are the same action, so they must
        // not look like two different ones.
        <ProductPickRow product={item} qtyInCart={inCart.get(item.id)} onAdd={onAdd} />
      )}
    />
  );
}

// ---------------------------------------------------------------------------

type CartProps = {
  lines: CartLine[];
  stockById: Record<number, number>;
  supplyType: SupplyType;
  quickPick: QuickPick;
  inCart: Map<number, number>;
  onAdd: (product: Product) => void;
  onChangeQty: (productId: number, qty: number) => void;
  onStep: (productId: number, delta: number) => void;
  onChangeUnit: (productId: number, unit: BillUnit | null) => void;
  onRemove: (productId: number) => void;
};

/**
 * The bill, with the quick-pick list attached (T3.8).
 *
 * On an empty bill the quick picks ARE the screen — there is nothing else to
 * look at, and a counter starting a sale wants the common items under the thumb
 * immediately. Once the bill has lines, they move below it: what has been added
 * is what needs checking, and the picks become a way to add one more.
 */
function Cart({
  lines,
  stockById,
  supplyType,
  quickPick,
  inCart,
  onAdd,
  onChangeQty,
  onStep,
  onChangeUnit,
  onRemove,
}: CartProps) {
  const picks = (separated: boolean) =>
    quickPick.sections.length > 0 ? (
      <QuickPickList
        sections={quickPick.sections}
        inCart={inCart}
        onAdd={onAdd}
        separated={separated}
      />
    ) : null;

  if (lines.length === 0) {
    return (
      <FlatList
        data={[]}
        renderItem={null}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={styles.emptyBillNote}>
              <Ionicons name="receipt-outline" size={20} color={Colors.textMuted} />
              <Text style={styles.emptyBody}>
                {quickPick.sections.length > 0
                  ? 'Nothing on this bill yet — tap a product below, search, or pick a category.'
                  : 'No items on this bill yet. Search above to find a product.'}
              </Text>
            </View>
            {picks(false)}
          </View>
        }
      />
    );
  }

  return (
    <FlatList
      data={lines}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyExtractor={(line) => String(line.productId)}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <BillItemRow
          line={item}
          stockQty={stockById[item.productId] ?? null}
          supplyType={supplyType}
          onChangeQty={onChangeQty}
          onStep={onStep}
          onChangeUnit={onChangeUnit}
          onRemove={onRemove}
        />
      )}
      ListFooterComponent={
        <View>
          {picks(true)}
          <Text style={styles.nextStepNote}>
            The GST breakdown and “Generate Bill” come after the customer details.
          </Text>
        </View>
      }
    />
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },

  stepSwitch: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  stepTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: Spacing.minTapTarget,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  stepTabActive: { borderBottomColor: Colors.brand, backgroundColor: Colors.background },
  stepTabText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.textMuted },
  stepTabTextActive: { color: Colors.brand, fontWeight: '700' },

  customerScroll: { flex: 1 },
  customerScrollContent: { paddingBottom: Spacing.xl },

  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    margin: Spacing.md,
    height: Spacing.minTapTarget + 4,
    borderRadius: 8,
    backgroundColor: Colors.brand,
  },
  primaryButtonPressed: { backgroundColor: Colors.brandDark },
  primaryButtonBusy: { opacity: 0.7 },
  primaryButtonText: { color: '#FFFFFF', fontSize: FontSizes.body, fontWeight: '700' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    margin: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: Spacing.minTapTarget,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: FontSizes.body, color: Colors.text },

  error: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    color: Colors.outOfStock,
    fontSize: FontSizes.small,
  },
  paymentCard: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  paymentHeading: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  paymentRow: { flexDirection: 'row', gap: Spacing.sm },
  paymentOption: {
    flex: 1,
    minHeight: Spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  paymentOptionSelected: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  paidOptionSelected: { backgroundColor: Colors.inStock, borderColor: Colors.inStock },
  unpaidOptionSelected: { backgroundColor: Colors.lowStock, borderColor: Colors.lowStock },
  paymentOptionPressed: { backgroundColor: Colors.surface },
  paymentOptionText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.textMuted },
  paymentOptionTextSelected: { color: '#FFFFFF' },
  paymentHint: { fontSize: FontSizes.small, color: Colors.textMuted },
  paymentError: { fontSize: FontSizes.small, color: Colors.outOfStock, fontWeight: '600' },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: 8,
    backgroundColor: Colors.surface,
  },
  editBannerText: { flex: 1, fontSize: FontSizes.small, color: Colors.text },
  editWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  editWarningText: { flex: 1, fontSize: FontSizes.small, color: Colors.lowStock, fontWeight: '600' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  emptyTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyBillNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  emptyBody: { fontSize: FontSizes.body, color: Colors.textMuted, textAlign: 'center' },

  // A FlatList with no flex sizes to its content and overflows the column,
  // which is what put rows behind the pinned summary bar.
  list: { flex: 1 },
  /** Clears the pinned bar and the buttons beneath it. */
  listContent: { paddingBottom: Spacing.xl },

  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  summaryLeft: { flex: 1, gap: 2 },
  summaryCount: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  summaryWarning: { fontSize: FontSizes.small, color: Colors.outOfStock, fontWeight: '600' },
  summaryRight: { alignItems: 'flex-end', gap: 2 },
  summaryTotal: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  provisionalNote: { fontSize: FontSizes.small - 3, color: Colors.textMuted },
  clearText: { fontSize: FontSizes.small, color: Colors.outOfStock, fontWeight: '700' },

  viewCartHint: { paddingVertical: Spacing.sm, alignItems: 'center', backgroundColor: Colors.background },
  viewCartHintText: { fontSize: FontSizes.small, color: Colors.brand, fontWeight: '600' },

  nextStepNote: {
    padding: Spacing.lg,
    fontSize: FontSizes.small,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
