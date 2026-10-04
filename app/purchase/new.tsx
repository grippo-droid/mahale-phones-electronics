import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import ErrorBanner from '@/components/ErrorBanner';
import PurchaseSaveConfirm, { type ConfirmLine } from '@/components/PurchaseSaveConfirm';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { listProducts, type Product } from '@/db/products';
import { createPurchase, type NewPurchaseItem } from '@/db/purchases';
import { listVendors } from '@/db/vendors';
import type { VendorRow } from '@/db/schema';
import { formatRupees } from '@/lib/format';
import { useToastStore } from '@/store/toast';

/**
 * Recording what the shop bought (T10.3).
 *
 * Deliberately simpler than the billing screen. There is no cart to survive a
 * trip to another tab, no GST to compute, no invoice number to reserve and
 * nothing to print — a purchase is entered in one sitting from the vendor's
 * bill lying on the counter, and then it is done.
 *
 * The total is TYPED, not summed from the lines. The figure that matters is
 * what the vendor's bill says; their rounding, freight or a discount applied at
 * the bottom is their business, and a total this screen computed would quietly
 * disagree with the paper the owner is holding. The lines are what was bought.
 */

type DraftLine = {
  key: string;
  product: Product | null;
  name: string;
  qty: string;
  cost: string;
};

const blankLine = (): DraftLine => ({
  key: `${Date.now()}-${Math.random()}`,
  product: null,
  name: '',
  qty: '1',
  cost: '',
});

export default function NewPurchaseScreen() {
  const { vendorId } = useLocalSearchParams<{ vendorId?: string }>();

  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vendor, setVendor] = useState<VendorRow | null>(null);
  const [pickingVendor, setPickingVendor] = useState(false);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [total, setTotal] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = useToastStore((state) => state.show);

  useEffect(() => {
    listVendors(undefined)
      .then((rows) => {
        setVendors(rows);
        const preset = Number.parseInt(vendorId ?? '', 10);
        if (Number.isFinite(preset)) {
          setVendor(rows.find((row) => row.id === preset) ?? null);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [vendorId]);

  useEffect(() => {
    if (picking === null) return;
    let cancelled = false;
    listProducts({ search: productSearch })
      .then((rows) => {
        if (!cancelled) setResults(rows.slice(0, 40));
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [picking, productSearch]);

  const setLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  };

  /** What the lines come to, shown only as a cross-check against the typed total. */
  const linesTotal = lines.reduce((sum, line) => {
    const qty = Number.parseFloat(line.qty);
    const cost = Number.parseFloat(line.cost);
    if (!Number.isFinite(qty) || !Number.isFinite(cost)) return sum;
    return sum + Math.round(qty * cost * 100);
  }, 0) / 100;

  const typedTotal = Number.parseFloat(total);
  const usableLines = lines.filter(
    (line) =>
      line.name.trim() !== '' &&
      Number.isFinite(Number.parseFloat(line.qty)) &&
      Number.parseFloat(line.qty) > 0
  );

  const problems: string[] = [];
  if (!vendor) problems.push('Choose which vendor this is from.');
  if (usableLines.length === 0) problems.push('Add at least one item.');
  if (!Number.isFinite(typedTotal) || typedTotal <= 0) {
    problems.push('Enter the total on the vendor’s bill.');
  }

  const confirmLines: ConfirmLine[] = usableLines.map((line) => ({
    productId: line.product?.id ?? null,
    name: line.name.trim(),
    qty: Number.parseFloat(line.qty),
    unit: null,
    costPrice: Number.parseFloat(line.cost) || 0,
  }));

  const save = useCallback(
    async (choice: { applyStock: boolean; updateCostFor: number[] }) => {
      if (!vendor) return;
      setSaving(true);
      try {
        const items: NewPurchaseItem[] = usableLines.map((line) => {
          const qty = Number.parseFloat(line.qty);
          const cost = Number.parseFloat(line.cost) || 0;
          return {
            product_id: line.product?.id ?? null,
            product_name_snapshot: line.name.trim(),
            qty,
            unit: null,
            cost_price: cost,
            line_total: Math.round(qty * cost * 100) / 100,
          };
        });

        const created = await createPurchase({
          vendor_id: vendor.id,
          vendor_ref: reference,
          total_amount: typedTotal,
          notes,
          items,
          applyStock: choice.applyStock,
          updateCostFor: choice.updateCostFor,
        });

        setConfirming(false);
        show(`Saved — ${formatRupees(created.total_amount)} from ${vendor.name}`);
        router.replace({
          pathname: '/purchase/[id]',
          params: { id: String(created.id) },
        });
      } catch (err) {
        setConfirming(false);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [vendor, usableLines, reference, typedTotal, notes, show]
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Record a Purchase' }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        <Text style={styles.label}>Vendor</Text>
        <Pressable
          style={styles.picker}
          onPress={() => setPickingVendor(true)}
          accessibilityRole="button"
          accessibilityLabel={vendor ? `Vendor: ${vendor.name}. Change it.` : 'Choose a vendor'}>
          <Text style={vendor ? styles.pickerValue : styles.pickerPlaceholder}>
            {vendor ? vendor.name : 'Choose a vendor'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
        </Pressable>

        <Text style={styles.label}>Their bill number</Text>
        <TextInput
          style={styles.field}
          placeholder="As printed on their bill (optional)"
          placeholderTextColor={Colors.textMuted}
          value={reference}
          onChangeText={setReference}
          autoCapitalize="characters"
          accessibilityLabel="The vendor's own bill number"
        />

        <Text style={styles.label}>Items</Text>
        {lines.map((line, index) => (
          <View key={line.key} style={styles.lineCard}>
            <View style={styles.lineTop}>
              <Pressable
                style={styles.lineName}
                onPress={() => {
                  setPicking(line.key);
                  setProductSearch('');
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  line.name ? `Item: ${line.name}. Change it.` : 'Choose an item'
                }>
                <Text style={line.name ? styles.pickerValue : styles.pickerPlaceholder}>
                  {line.name || 'Choose or type an item'}
                </Text>
              </Pressable>

              {lines.length > 1 ? (
                <Pressable
                  onPress={() => setLines((cur) => cur.filter((l) => l.key !== line.key))}
                  hitSlop={Spacing.sm}
                  style={styles.removeLine}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove item ${index + 1}`}>
                  <Ionicons name="close" size={18} color={Colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            {line.product === null && line.name.trim() !== '' ? (
              <Text style={styles.looseNote}>Not in Inventory — stock will not change</Text>
            ) : null}

            <View style={styles.lineFields}>
              <View style={styles.lineField}>
                <Text style={styles.lineFieldLabel}>Quantity</Text>
                <TextInput
                  style={styles.field}
                  value={line.qty}
                  onChangeText={(text) => setLine(line.key, { qty: text })}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Quantity for item ${index + 1}`}
                />
              </View>
              <View style={styles.lineField}>
                <Text style={styles.lineFieldLabel}>Cost each</Text>
                <TextInput
                  style={styles.field}
                  value={line.cost}
                  onChangeText={(text) => setLine(line.key, { cost: text })}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  accessibilityLabel={`Cost per unit for item ${index + 1}`}
                />
              </View>
            </View>
          </View>
        ))}

        <Pressable
          style={styles.addLine}
          onPress={() => setLines((cur) => [...cur, blankLine()])}
          accessibilityRole="button"
          accessibilityLabel="Add another item">
          <Ionicons name="add" size={18} color={Colors.brand} />
          <Text style={styles.addLineText}>Add another item</Text>
        </Pressable>

        <Text style={styles.label}>Total on their bill</Text>
        <TextInput
          style={styles.field}
          value={total}
          onChangeText={setTotal}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel="The total amount on the vendor's bill"
        />
        {/* Typed rather than summed, and the lines' own total shown beside it
            as a cross-check. They can legitimately differ — freight, a discount
            at the bottom, the vendor's own rounding — so this reports the gap
            rather than refusing it. */}
        {linesTotal > 0 ? (
          <Text
            style={[
              styles.linesTotal,
              Number.isFinite(typedTotal) &&
                Math.round(typedTotal * 100) !== Math.round(linesTotal * 100) &&
                styles.linesTotalDiffers,
            ]}>
            Items add up to {formatRupees(linesTotal)}
            {Number.isFinite(typedTotal) &&
            Math.round(typedTotal * 100) !== Math.round(linesTotal * 100)
              ? ' — different from the total above, which is what will be saved'
              : ''}
          </Text>
        ) : null}

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.field, styles.notes]}
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Anything worth remembering (optional)"
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel="Notes about this purchase"
        />

        {problems.length > 0 ? (
          <View style={styles.problems}>
            {problems.map((problem) => (
              <Text key={problem} style={styles.problem}>
                {problem}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* Never greyed out: a disabled button that does not say why is the most
          confusing thing to hand a first-time user. Pressed while incomplete,
          it shows what is missing above. */}
      <Pressable
        style={({ pressed }) => [styles.save, pressed && styles.savePressed]}
        onPress={() => {
          if (problems.length > 0) return;
          setConfirming(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Save this purchase">
        <Text style={styles.saveText}>Save purchase</Text>
      </Pressable>

      <PurchaseSaveConfirm
        visible={confirming}
        lines={confirmLines}
        total={Number.isFinite(typedTotal) ? typedTotal : 0}
        saving={saving}
        onCancel={() => setConfirming(false)}
        onConfirm={save}
      />

      <Modal
        visible={pickingVendor}
        transparent
        animationType="fade"
        onRequestClose={() => setPickingVendor(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickingVendor(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose a vendor</Text>
            <FlatList
              data={vendors}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.sheetRow}
                  onPress={() => {
                    setVendor(item);
                    setPickingVendor(false);
                  }}
                  accessibilityRole="button">
                  <Text style={styles.sheetRowText}>{item.name}</Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.sheetEmpty}>
                  No vendors yet. Add one from the Vendors screen first.
                </Text>
              }
            />
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={picking !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPicking(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose an item</Text>
            <TextInput
              style={styles.field}
              placeholder="Search Inventory, or type a name"
              placeholderTextColor={Colors.textMuted}
              value={productSearch}
              onChangeText={setProductSearch}
              autoFocus
              accessibilityLabel="Search for a product"
            />

            {/* Anything can be bought, including things the shop does not
                stock — packing material, a one-off spare. A typed name with no
                product behind it is a real line; it simply moves no stock. */}
            {productSearch.trim() !== '' ? (
              <Pressable
                style={styles.sheetRow}
                onPress={() => {
                  if (picking) setLine(picking, { product: null, name: productSearch.trim() });
                  setPicking(null);
                }}
                accessibilityRole="button">
                <Ionicons name="create-outline" size={18} color={Colors.brand} />
                <Text style={styles.sheetRowBrand}>
                  Use &ldquo;{productSearch.trim()}&rdquo; as a one-off
                </Text>
              </Pressable>
            ) : null}

            <FlatList
              data={results}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  style={styles.sheetRow}
                  onPress={() => {
                    if (picking) {
                      setLine(picking, {
                        product: item,
                        name: item.name,
                        cost:
                          item.purchase_price !== null && item.purchase_price !== undefined
                            ? String(item.purchase_price)
                            : '',
                      });
                    }
                    setPicking(null);
                  }}
                  accessibilityRole="button">
                  <View style={styles.sheetRowMain}>
                    <Text style={styles.sheetRowText}>{item.name}</Text>
                    <Text style={styles.sheetRowSub}>
                      {item.stock_qty} in stock
                      {item.purchase_price !== null && item.purchase_price !== undefined
                        ? ` · last cost ${formatRupees(item.purchase_price)}`
                        : ''}
                    </Text>
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.sheetEmpty}>
                  {productSearch.trim() === '' ? (
                    <ActivityIndicator color={Colors.brand} />
                  ) : (
                    'Nothing in Inventory matches that.'
                  )}
                </Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, gap: Spacing.xs, paddingBottom: Spacing.xl },

  label: {
    fontSize: FontSizes.small,
    fontWeight: '700',
    color: Colors.textMuted,
    marginTop: Spacing.sm,
  },
  field: {
    minHeight: Spacing.minTapTarget,
    paddingHorizontal: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: FontSizes.body,
    color: Colors.text,
  },
  notes: { minHeight: 72, textAlignVertical: 'top', paddingTop: Spacing.sm },

  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: Spacing.minTapTarget,
    paddingHorizontal: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickerValue: { fontSize: FontSizes.body, color: Colors.text },
  pickerPlaceholder: { fontSize: FontSizes.body, color: Colors.textMuted },

  lineCard: {
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: 8,
    backgroundColor: Colors.surface,
  },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  lineName: {
    flex: 1,
    minHeight: Spacing.minTapTarget,
    justifyContent: 'center',
  },
  removeLine: {
    width: Spacing.minTapTarget,
    height: Spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  looseNote: { fontSize: FontSizes.small, color: Colors.lowStock },
  lineFields: { flexDirection: 'row', gap: Spacing.sm },
  lineField: { flex: 1, gap: 2 },
  lineFieldLabel: { fontSize: FontSizes.small, color: Colors.textMuted },

  addLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    minHeight: Spacing.minTapTarget,
  },
  addLineText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.brand },

  linesTotal: { fontSize: FontSizes.small, color: Colors.textMuted },
  linesTotalDiffers: { color: Colors.lowStock },

  problems: {
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: 8,
    backgroundColor: Colors.lowStockTint,
  },
  problem: { fontSize: FontSizes.small, color: Colors.lowStock, fontWeight: '600' },

  save: {
    margin: Spacing.md,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: Colors.brand,
  },
  savePressed: { backgroundColor: Colors.brandDark },
  saveText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  sheet: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: Spacing.md,
    gap: Spacing.sm,
    maxHeight: '75%',
  },
  sheetTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetRowMain: { flex: 1 },
  sheetRowText: { fontSize: FontSizes.body, color: Colors.text },
  sheetRowSub: { fontSize: FontSizes.small, color: Colors.textMuted },
  sheetRowBrand: { fontSize: FontSizes.body, color: Colors.brand, fontWeight: '600' },
  sheetEmpty: { padding: Spacing.md, fontSize: FontSizes.body, color: Colors.textMuted },
});
