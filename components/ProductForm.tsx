import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import type { NewProduct } from '@/db/products';
import { GST_RATE_SLABS, PRODUCT_CATEGORIES } from '@/db/schema';
import { formatRupees } from '@/lib/format';
import { splitPrice } from '@/lib/gst';
import { calculateMargin } from '@/lib/margin';

/**
 * Shared add/edit product form (T2.3, T2.4).
 *
 * Numeric fields are held as strings while typing and parsed on submit —
 * converting on every keystroke fights the user over a half-typed "12." and
 * makes a decimal point impossible to enter on some keyboards.
 *
 * Category and GST rate are chip rows rather than a picker component: both lists
 * are short and fixed, and chips give large tap targets without pulling in a
 * dependency the Architecture doc does not call for.
 */

export type ProductFormValues = {
  name: string;
  category: string;
  stockQty: string;
  unitPrice: string;
  gstRate: number;
  hsnCode: string;
  brand: string;
  modelNumber: string;
  lowStockThreshold: string;
  priceIncludesGst: boolean;
  /** Internal cost reference — never printed on a bill. */
  purchasePrice: string;
};

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  name: '',
  category: PRODUCT_CATEGORIES[0],
  stockQty: '',
  unitPrice: '',
  gstRate: 18,
  hsnCode: '',
  brand: '',
  modelNumber: '',
  lowStockThreshold: '',
  priceIncludesGst: false,
  purchasePrice: '',
};

type FieldErrors = Partial<Record<keyof ProductFormValues, string>>;

type Props = {
  initialValues?: ProductFormValues;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (product: NewProduct) => void | Promise<void>;
  /** Rendered under the save button — used by T2.5/T2.6 to add delete/restock. */
  footer?: React.ReactNode;
  /**
   * Hidden on the edit screen, where stock is changed through StockAdjuster
   * instead. Two controls writing the same column would let a stale form value
   * silently undo an adjustment made moments earlier.
   */
  showStockField?: boolean;
};

export default function ProductForm({
  initialValues = EMPTY_PRODUCT_FORM,
  submitLabel,
  busy = false,
  onSubmit,
  footer,
  showStockField = true,
}: Props) {
  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    // Clear the error as soon as the field is touched, rather than making the
    // user re-submit to find out whether they fixed it.
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const handleSubmit = async () => {
    const { product, fieldErrors } = validate(values);
    if (!product) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    await onSubmit(product);
  };

  const hsnMissing = values.hsnCode.trim() === '';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <Field label="Product name" required error={errors.name}>
          <TextInput
            style={[styles.input, errors.name && styles.inputError]}
            value={values.name}
            onChangeText={(text) => set('name', text)}
            placeholder="e.g. Hikvision Dome Camera 2MP"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
          />
        </Field>

        <Field label="Category" required error={errors.category}>
          <View style={styles.chipWrap}>
            {PRODUCT_CATEGORIES.map((category) => {
              const active = values.category === category;
              return (
                <Pressable
                  key={category}
                  onPress={() => set('category', category)}
                  style={[styles.chip, active && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {category}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <View style={styles.row}>
          {showStockField ? (
            <View style={styles.flex}>
              <Field label="Opening stock" required error={errors.stockQty}>
                <TextInput
                  style={[styles.input, errors.stockQty && styles.inputError]}
                  value={values.stockQty}
                  onChangeText={(text) => set('stockQty', text)}
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                />
              </Field>
            </View>
          ) : null}
          <View style={styles.flex}>
            <Field label="Unit price (₹)" required error={errors.unitPrice}>
              <TextInput
                style={[styles.input, errors.unitPrice && styles.inputError]}
                value={values.unitPrice}
                onChangeText={(text) => set('unitPrice', text)}
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
            </Field>
          </View>
        </View>

        <Field label="GST rate" required error={errors.gstRate}>
          <View style={styles.chipWrap}>
            {GST_RATE_SLABS.map((rate) => {
              const active = values.gstRate === rate;
              return (
                <Pressable
                  key={rate}
                  onPress={() => set('gstRate', rate)}
                  style={[styles.chip, active && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{rate}%</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="Does the price above include GST?" required>
          <View style={styles.chipWrap}>
            <Pressable
              onPress={() => set('priceIncludesGst', false)}
              style={[styles.chip, !values.priceIncludesGst && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: !values.priceIncludesGst }}>
              <Text style={[styles.chipText, !values.priceIncludesGst && styles.chipTextActive]}>
                No — add GST on top
              </Text>
            </Pressable>
            <Pressable
              onPress={() => set('priceIncludesGst', true)}
              style={[styles.chip, values.priceIncludesGst && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: values.priceIncludesGst }}>
              <Text style={[styles.chipText, values.priceIncludesGst && styles.chipTextActive]}>
                Yes — price is final
              </Text>
            </Pressable>
          </View>
        </Field>

        <PricePreview
          unitPrice={values.unitPrice}
          gstRate={values.gstRate}
          priceIncludesGst={values.priceIncludesGst}
        />

        <Field
          label="Purchase price (₹)"
          error={errors.purchasePrice}
          hint="Optional. What you paid per unit — for your reference only, never shown on a bill.">
          <TextInput
            style={[styles.input, errors.purchasePrice && styles.inputError]}
            value={values.purchasePrice}
            onChangeText={(text) => set('purchasePrice', text)}
            placeholder="Not recorded"
            placeholderTextColor={Colors.textMuted}
            keyboardType="decimal-pad"
          />
        </Field>

        <MarginPreview
          purchasePrice={values.purchasePrice}
          unitPrice={values.unitPrice}
          gstRate={values.gstRate}
          priceIncludesGst={values.priceIncludesGst}
        />

        <Field label="HSN code" error={errors.hsnCode} hint="Optional, but needed on GST bills">
          <TextInput
            style={[styles.input, errors.hsnCode && styles.inputError]}
            value={values.hsnCode}
            onChangeText={(text) => set('hsnCode', text)}
            placeholder="e.g. 85258900"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
          />
          {hsnMissing ? (
            <View style={styles.warning}>
              <Ionicons name="warning-outline" size={16} color={Colors.lowStock} />
              <Text style={styles.warningText}>
                Without an HSN code this product&apos;s line will be incomplete on GST invoices.
                You can save it now and add the code later.
              </Text>
            </View>
          ) : null}
        </Field>

        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label="Brand">
              <TextInput
                style={styles.input}
                value={values.brand}
                onChangeText={(text) => set('brand', text)}
                placeholder="e.g. Philips"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
              />
            </Field>
          </View>
          <View style={styles.flex}>
            <Field label="Model number">
              <TextInput
                style={styles.input}
                value={values.modelNumber}
                onChangeText={(text) => set('modelNumber', text)}
                placeholder="Optional"
                placeholderTextColor={Colors.textMuted}
              />
            </Field>
          </View>
        </View>

        <Field
          label="Low stock alert at"
          error={errors.lowStockThreshold}
          hint="Leave blank to use the shop-wide default">
          <TextInput
            style={[styles.input, errors.lowStockThreshold && styles.inputError]}
            value={values.lowStockThreshold}
            onChangeText={(text) => set('lowStockThreshold', text)}
            placeholder="Default"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
          />
        </Field>

        <Pressable
          style={[styles.saveButton, busy && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={busy}
          accessibilityRole="button">
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.saveButtonText}>{submitLabel}</Text>
          )}
        </Pressable>

        {footer}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Live breakdown of the entered price, shown in both directions regardless of
 * which basis is selected. Whoever enters a price can see the pre-tax value and
 * the figure the customer actually hands over before saving, so a product
 * entered on the wrong basis is caught here rather than on a printed bill.
 */
function PricePreview({
  unitPrice,
  gstRate,
  priceIncludesGst,
}: {
  unitPrice: string;
  gstRate: number;
  priceIncludesGst: boolean;
}) {
  const parsed = Number(unitPrice.trim());
  const hasPrice = unitPrice.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  if (!hasPrice) {
    return (
      <View style={styles.preview}>
        <Text style={styles.previewEmpty}>Enter a price to see the GST breakdown.</Text>
      </View>
    );
  }

  const { exclusive, inclusive, taxPerUnit } = splitPrice(parsed, gstRate, priceIncludesGst);

  return (
    <View style={styles.preview}>
      <PreviewRow
        label="Base price (before GST)"
        value={formatRupees(exclusive)}
        highlight={!priceIncludesGst}
      />
      <PreviewRow label={`GST at ${gstRate}%`} value={formatRupees(taxPerUnit)} />
      <View style={styles.previewDivider} />
      <PreviewRow
        label="Customer pays"
        value={formatRupees(inclusive)}
        highlight={priceIncludesGst}
        strong
      />
      <Text style={styles.previewNote}>
        {priceIncludesGst
          ? 'You entered the final price. GST is worked backwards out of it.'
          : 'You entered the base price. GST is added on top.'}
      </Text>
    </View>
  );
}

/**
 * Live profit indicator. Appears only once both a cost and a selling price are
 * present, so it never nags on a product whose cost was not recorded.
 *
 * Internal to the app — this is the figure the shop should not show a customer.
 */
function MarginPreview({
  purchasePrice,
  unitPrice,
  gstRate,
  priceIncludesGst,
}: {
  purchasePrice: string;
  unitPrice: string;
  gstRate: number;
  priceIncludesGst: boolean;
}) {
  const cost = purchasePrice.trim() === '' ? null : Number(purchasePrice.trim());
  const selling = Number(unitPrice.trim());
  const margin = calculateMargin(cost, selling, gstRate, priceIncludesGst);

  if (!margin) return null;

  const tone = margin.isLoss ? Colors.outOfStock : Colors.inStock;

  return (
    <View style={[styles.preview, styles.marginPreview, { borderColor: tone }]}>
      <View style={styles.previewRow}>
        <Text style={styles.previewLabel}>You keep (price before GST)</Text>
        <Text style={styles.previewValue}>{formatRupees(margin.netSellingPrice)}</Text>
      </View>
      <View style={styles.previewRow}>
        <Text style={styles.previewLabel}>You paid</Text>
        <Text style={styles.previewValue}>−{formatRupees(margin.cost)}</Text>
      </View>

      <View style={styles.previewDivider} />

      <View style={styles.previewRow}>
        <Text style={[styles.previewLabel, { color: tone, fontWeight: '700' }]}>
          {margin.isLoss ? 'Loss per unit' : 'Profit per unit'}
        </Text>
        <Text style={[styles.previewValue, styles.previewValueStrong, { color: tone }]}>
          {formatRupees(Math.abs(margin.profit))}
        </Text>
      </View>

      <View style={styles.marginPercentRow}>
        {margin.marginPercent !== null ? (
          <View style={styles.marginPercentBox}>
            <Text style={[styles.marginPercentValue, { color: tone }]}>
              {margin.marginPercent}%
            </Text>
            <Text style={styles.marginPercentLabel}>margin{'\n'}(of what you keep)</Text>
          </View>
        ) : null}
        {margin.markupPercent !== null ? (
          <View style={styles.marginPercentBox}>
            <Text style={[styles.marginPercentValue, { color: tone }]}>
              {margin.markupPercent}%
            </Text>
            <Text style={styles.marginPercentLabel}>markup{'\n'}(added to cost)</Text>
          </View>
        ) : null}
      </View>

      {margin.isLoss ? (
        <View style={styles.warning}>
          <Ionicons name="warning-outline" size={16} color={Colors.lowStock} />
          <Text style={styles.warningText}>
            This sells for less than it cost. Check the prices before saving.
          </Text>
        </View>
      ) : null}

      <Text style={styles.previewNote}>
        Your own reference only — purchase price and profit never appear on a customer&apos;s
        bill.
      </Text>
    </View>
  );
}

function PreviewRow({
  label,
  value,
  highlight,
  strong,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  strong?: boolean;
}) {
  return (
    <View style={styles.previewRow}>
      <Text style={[styles.previewLabel, highlight && styles.previewHighlightText]}>
        {label}
        {highlight ? ' (entered)' : ''}
      </Text>
      <Text
        style={[
          styles.previewValue,
          strong && styles.previewValueStrong,
          highlight && styles.previewHighlightText,
        ]}>
        {value}
      </Text>
    </View>
  );
}

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.requiredMark}> *</Text> : null}
      </Text>
      {children}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * Mirrors the rules enforced in `db/products.ts`. The repository stays the
 * authority — this exists so the user sees which field is wrong instead of a
 * single thrown error at save time.
 */
export function validate(values: ProductFormValues): {
  product: NewProduct | null;
  fieldErrors: FieldErrors;
} {
  const fieldErrors: FieldErrors = {};

  if (!values.name.trim()) fieldErrors.name = 'Enter a product name.';
  if (!values.category.trim()) fieldErrors.category = 'Choose a category.';

  const stockQty = Number(values.stockQty.trim());
  if (values.stockQty.trim() === '') {
    fieldErrors.stockQty = 'Enter a quantity.';
  } else if (!Number.isFinite(stockQty) || !Number.isInteger(stockQty)) {
    fieldErrors.stockQty = 'Whole numbers only.';
  }

  const unitPrice = Number(values.unitPrice.trim());
  if (values.unitPrice.trim() === '') {
    fieldErrors.unitPrice = 'Enter a price.';
  } else if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    fieldErrors.unitPrice = 'Enter a valid price.';
  }

  if (!Number.isFinite(values.gstRate) || values.gstRate < 0 || values.gstRate > 100) {
    fieldErrors.gstRate = 'Choose a GST rate.';
  }

  let purchasePrice: number | null = null;
  const rawPurchase = values.purchasePrice.trim();
  if (rawPurchase !== '') {
    const parsed = Number(rawPurchase);
    if (!Number.isFinite(parsed) || parsed < 0) {
      fieldErrors.purchasePrice = 'Enter a valid amount, or leave it blank.';
    } else {
      purchasePrice = parsed;
    }
  }

  let lowStockThreshold: number | null = null;
  const rawThreshold = values.lowStockThreshold.trim();
  if (rawThreshold !== '') {
    const parsed = Number(rawThreshold);
    if (!Number.isInteger(parsed) || parsed < 0) {
      fieldErrors.lowStockThreshold = 'Whole numbers, zero or more.';
    } else {
      lowStockThreshold = parsed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { product: null, fieldErrors };

  return {
    product: {
      name: values.name.trim(),
      category: values.category,
      stock_qty: stockQty,
      unit_price: unitPrice,
      gst_rate: values.gstRate,
      hsn_code: values.hsnCode.trim() || null,
      brand: values.brand.trim() || null,
      model_number: values.modelNumber.trim() || null,
      low_stock_threshold: lowStockThreshold,
      price_includes_gst: values.priceIncludesGst,
      purchase_price: purchasePrice,
    },
    fieldErrors: {},
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.xs },
  field: { marginBottom: Spacing.md },
  label: { fontSize: FontSizes.small, fontWeight: '700', color: Colors.text, marginBottom: Spacing.xs },
  requiredMark: { color: Colors.outOfStock },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    fontSize: FontSizes.body,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  inputError: { borderColor: Colors.outOfStock },
  errorText: { fontSize: FontSizes.small, color: Colors.outOfStock, marginTop: Spacing.xs },
  hint: { fontSize: FontSizes.small - 1, color: Colors.textMuted, marginTop: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.md },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  chipText: { fontSize: FontSizes.small, color: Colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: 8,
    backgroundColor: '#FFF4E5',
    borderWidth: 1,
    borderColor: Colors.lowStock,
  },
  warningText: { flex: 1, fontSize: FontSizes.small, color: Colors.text, lineHeight: 18 },
  preview: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  previewEmpty: { fontSize: FontSizes.small, color: Colors.textMuted, textAlign: 'center' },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.sm },
  previewLabel: { flex: 1, fontSize: FontSizes.small, color: Colors.textMuted },
  previewValue: { fontSize: FontSizes.body, color: Colors.text, fontWeight: '600' },
  previewValueStrong: { fontSize: FontSizes.title, fontWeight: '700' },
  previewHighlightText: { color: Colors.brand },
  previewDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.xs },
  previewNote: { fontSize: FontSizes.small - 1, color: Colors.textMuted, marginTop: Spacing.xs },
  marginPreview: { borderWidth: 1 },
  marginPercentRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  marginPercentBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: 8,
    backgroundColor: Colors.background,
  },
  marginPercentValue: { fontSize: FontSizes.title, fontWeight: '700' },
  marginPercentLabel: {
    fontSize: FontSizes.small - 3,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  saveButton: {
    backgroundColor: Colors.brand,
    borderRadius: 8,
    minHeight: Spacing.minTapTarget + 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#FFFFFF', fontSize: FontSizes.title, fontWeight: '700' },
});
