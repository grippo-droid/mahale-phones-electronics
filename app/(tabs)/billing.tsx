import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import CustomerDetailsForm from '@/components/CustomerDetailsForm';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { getProductsByIds, listProducts, type Product } from '@/db/products';
import { resolveSupplyType, validateCustomer, type CustomerField } from '@/lib/customer';
import { formatRupees } from '@/lib/format';
import { calculateBill, type SupplyType } from '@/lib/gst';
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
 * On the items step one search box drives everything: type to find products to
 * add, clear it to see the bill. The running total sits in a bar pinned to the
 * bottom, so what has been added stays visible on both steps.
 *
 * The GST breakdown panel is T3.5 and "Generate Bill" is T3.6.
 */

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_RESULT_LIMIT = 40;

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
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Live stock by product id, refreshed from the database — never from the cart. */
  const [stockById, setStockById] = useState<Record<number, number>>({});

  const lines = useCartStore(selectLines);
  const itemCount = useCartStore(selectItemCount);
  const customer = useCartStore(selectCustomer);
  const addProduct = useCartStore((state) => state.addProduct);
  const setQty = useCartStore((state) => state.setQty);
  const changeQty = useCartStore((state) => state.changeQty);
  const removeLine = useCartStore((state) => state.removeLine);
  const setCustomerField = useCartStore((state) => state.setCustomerField);
  const clear = useCartStore((state) => state.clear);

  const hasSearchTerm = debouncedSearch.trim().length > 0;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Product search.
  useEffect(() => {
    let cancelled = false;

    if (!hasSearchTerm) {
      setResults([]);
      return;
    }

    setSearching(true);
    listProducts({ search: debouncedSearch, limit: SEARCH_RESULT_LIMIT })
      .then((rows) => {
        if (cancelled) return;
        setResults(rows);
        // Search results carry fresh stock, so fold them into the map too.
        setStockById((current) => ({
          ...current,
          ...Object.fromEntries(rows.map((row) => [row.id, row.stock_qty])),
        }));
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, hasSearchTerm]);

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
  // the Inventory tab. Re-read it whenever this screen comes back into view.
  useFocusEffect(
    useCallback(() => {
      refreshStock();
    }, [refreshStock])
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
  const supplyType = useMemo(() => resolveSupplyType(customer.state), [customer.state]);

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

  const handleBlurField = useCallback((field: CustomerField) => {
    setTouched((current) => ({ ...current, [field]: true }));
  }, []);

  const customerValidation = useMemo(() => validateCustomer(customer), [customer]);

  const showResults = step === 'items' && hasSearchTerm;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StepSwitch step={step} onChange={setStep} customerDone={customerValidation.canGenerate} />

      {step === 'items' ? (
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
          />
          <Text style={styles.nextStepNote}>
            The GST breakdown and “Generate Bill” come next.
          </Text>
        </ScrollView>
      ) : showResults ? (
        <SearchResults
          results={results}
          searching={searching}
          inCart={inCart}
          onAdd={handleAdd}
          term={debouncedSearch}
        />
      ) : (
        <Cart
          lines={lines}
          stockById={stockById}
          supplyType={supplyType ?? PROVISIONAL_SUPPLY_TYPE}
          onChangeQty={setQty}
          onStep={changeQty}
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

      {showResults && lines.length > 0 ? (
        <Pressable
          style={styles.viewCartHint}
          onPress={() => setSearchInput('')}
          accessibilityRole="button"
          accessibilityLabel="Clear the search to see the bill">
          <Text style={styles.viewCartHintText}>Clear search to see the bill</Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------

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
};

function SearchResults({ results, searching, inCart, onAdd, term }: SearchResultsProps) {
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
        <Text style={styles.emptyTitle}>Nothing matches “{term}”</Text>
        <Text style={styles.emptyBody}>
          Try part of the name, brand, model number or HSN code.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={results}
      keyExtractor={(product) => String(product.id)}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <SearchResultRow product={item} qtyInCart={inCart.get(item.id)} onAdd={onAdd} />
      )}
    />
  );
}

type SearchResultRowProps = {
  product: Product;
  qtyInCart: number | undefined;
  onAdd: (product: Product) => void;
};

function SearchResultRow({ product, qtyInCart, onAdd }: SearchResultRowProps) {
  const out = product.stock_qty <= 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
      onPress={() => onAdd(product)}
      accessibilityRole="button"
      accessibilityLabel={`Add ${product.name} to the bill`}>
      <View style={styles.resultMain}>
        <Text style={styles.resultName} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={[styles.resultStock, out && styles.resultStockOut]}>
          {product.stock_qty} in stock
          {/* Selling past zero is allowed; the cart line spells out the effect. */}
          {out ? ' — can still be billed' : ''}
        </Text>
      </View>

      <View style={styles.resultSide}>
        <Text style={styles.resultPrice}>{formatRupees(product.unit_price)}</Text>
        {qtyInCart ? (
          <View style={styles.inCartTag}>
            <Ionicons name="checkmark" size={12} color="#FFFFFF" />
            <Text style={styles.inCartText}>{qtyInCart} on bill</Text>
          </View>
        ) : (
          <Ionicons name="add-circle" size={26} color={Colors.brand} />
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

type CartProps = {
  lines: CartLine[];
  stockById: Record<number, number>;
  supplyType: SupplyType;
  onChangeQty: (productId: number, qty: number) => void;
  onStep: (productId: number, delta: number) => void;
  onRemove: (productId: number) => void;
};

function Cart({ lines, stockById, supplyType, onChangeQty, onStep, onRemove }: CartProps) {
  if (lines.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="receipt-outline" size={48} color={Colors.border} />
        <Text style={styles.emptyTitle}>No items on this bill yet</Text>
        <Text style={styles.emptyBody}>
          Search above to find a product, then tap it to add it to the bill.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={lines}
      keyExtractor={(line) => String(line.productId)}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <BillItemRow
          line={item}
          stockQty={stockById[item.productId] ?? null}
          supplyType={supplyType}
          onChangeQty={onChangeQty}
          onStep={onStep}
          onRemove={onRemove}
        />
      )}
      ListFooterComponent={
        <Text style={styles.nextStepNote}>
          The GST breakdown and “Generate Bill” come after the customer details.
        </Text>
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
  customerScrollContent: { paddingBottom: Spacing.lg },

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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  emptyTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyBody: { fontSize: FontSizes.body, color: Colors.textMuted, textAlign: 'center' },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  resultRowPressed: { backgroundColor: Colors.surface },
  resultMain: { flex: 1, gap: 2 },
  resultName: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  resultStock: { fontSize: FontSizes.small, color: Colors.textMuted },
  resultStockOut: { color: Colors.outOfStock, fontWeight: '600' },
  resultSide: { alignItems: 'flex-end', gap: Spacing.xs },
  resultPrice: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  inCartTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    backgroundColor: Colors.inStock,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
  },
  inCartText: { color: '#FFFFFF', fontSize: FontSizes.small - 3, fontWeight: '700' },

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
