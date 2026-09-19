import Ionicons from '@expo/vector-icons/Ionicons';
import * as Sharing from 'expo-sharing';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import ErrorBanner from '@/components/ErrorBanner';
import QuotationStatusBadge from '@/components/QuotationStatusBadge';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import {
  getQuotationById,
  quotationAgeInDays,
  setQuotationPdfPath,
  QUOTATION_STALE_DAYS,
  type QuotationWithItems,
} from '@/db/quotations';
import { getBillById, type BillWithItems } from '@/db/bills';
import { formatDate, formatRupees } from '@/lib/format';
import { customerDisplayName, hasCustomerName } from '@/lib/customer';
import { confirmDeleteQuotation, startEditingQuotation } from '@/lib/quotationActions';
import { quotationToCartLines } from '@/lib/quotationDraft';
import { existingQuotationPdf, generateQuotationPdf } from '@/lib/quotationPdf';
import { formatQuantityWithUnit } from '@/lib/units';
import { useCartStore } from '@/store/cart';
import { selectBusiness, useSettingsStore } from '@/store/settings';

/**
 * One quotation (T5.7): what was offered, and what became of it.
 *
 * Converting does NOT write a bill from here. It loads the quotation into the
 * billing cart and sends the owner to the Billing tab, where the bill is
 * generated the same way every other bill is — same customer step, same oversell
 * confirmation, same invoice numbering. Two paths that both write bills would be
 * two paths to keep in step, and the rarer one would be the less tested.
 *
 * It also means the prices can be checked before anything is committed, which
 * matters most on exactly the quotations that carry the age warning.
 */
export default function QuotationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const business = useSettingsStore(selectBusiness);

  const [quotation, setQuotation] = useState<QuotationWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  /** The bill this became, so the note can name it rather than just say "a bill". */
  const [convertedBill, setConvertedBill] = useState<BillWithItems | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFromQuotation = useCartStore((state) => state.loadFromQuotation);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await getQuotationById(Number(id));
        if (cancelled) return;
        setQuotation(found);

        if (found?.converted_bill_id != null) {
          const bill = await getBillById(found.converted_bill_id);
          if (!cancelled) setConvertedBill(bill);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const share = useCallback(async () => {
    if (!quotation) return;

    setSharing(true);
    setError(null);
    try {
      const existing = quotation.pdf_path ?? existingQuotationPdf(quotation.reference_number);
      const path = existing ?? (await generateQuotationPdf(quotation, business));

      if (!existing) {
        await setQuotationPdfPath(quotation.id, path);
        setQuotation((current) => (current ? { ...current, pdf_path: path } : current));
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/pdf',
          dialogTitle: `Quotation ${quotation.reference_number}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        setError('This phone has no way to share the file.');
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `The quotation is saved, but its PDF could not be made: ${err.message}`
          : 'The quotation is saved, but its PDF could not be made.'
      );
    } finally {
      setSharing(false);
    }
  }, [quotation, business]);

  const convert = useCallback(() => {
    if (!quotation) return;

    const age = quotationAgeInDays(quotation.date);
    const stale = age >= QUOTATION_STALE_DAYS;

    const proceed = () => {
      // The QUOTED prices, not today's — the customer was offered these. The
      // cart is editable, so repricing is a decision rather than a surprise.
      loadFromQuotation(
        quotationToCartLines(quotation),
        {
          name: quotation.customer_name,
          phone: quotation.customer_phone,
          address: quotation.customer_address ?? '',
          gstin: '',
          // Not carried over: a quotation never collects it, and the state is
          // what decides the tax heads, so it has to be answered on the bill.
          state: '',
        },
        quotation.id
      );
      router.push('/(tabs)/billing');
    };

    Alert.alert(
      `Convert ${quotation.reference_number}?`,
      (stale
        ? `This quotation is ${age} days old, so the prices on it may be out of date. `
        : '') +
        'The items and prices will be loaded into a new bill for you to check. ' +
        'The bill gets today’s date and its own invoice number, and nothing is ' +
        'saved until you generate it.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Load into a bill', onPress: proceed },
      ]
    );
  }, [quotation, loadFromQuotation]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  if (!quotation) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Quotation not found</Text>
        <Text style={styles.emptyBody}>It may have been removed.</Text>
      </View>
    );
  }

  const converted = quotation.converted_bill_id !== null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: quotation.reference_number }} />

      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.headLeft}>
            <Text style={styles.label}>Quotation No.</Text>
            <Text style={styles.reference}>{quotation.reference_number}</Text>
          </View>
          <View>
            <Text style={styles.label}>Date</Text>
            <Text style={styles.value}>{formatDate(quotation.date)}</Text>
          </View>
        </View>

        <QuotationStatusBadge quotation={quotation} />

        <View style={styles.divider} />

        <Text style={styles.label}>Quotation for</Text>
        <Text
          style={[styles.customerName, !hasCustomerName(quotation.customer_name) && styles.muted]}>
          {customerDisplayName(quotation.customer_name)}
        </Text>
        {quotation.customer_address ? (
          <Text style={styles.muted}>{quotation.customer_address}</Text>
        ) : null}
        {quotation.customer_phone.trim() ? (
          <Text style={styles.muted}>{quotation.customer_phone}</Text>
        ) : null}

        <View style={styles.divider} />

        {quotation.items.map((item, index) => (
          <View key={item.id} style={styles.item}>
            <View style={styles.itemMain}>
              <Text style={styles.itemName}>
                {index + 1}. {item.product_name_snapshot}
              </Text>
              <Text style={styles.muted}>
                {formatQuantityWithUnit(item.qty, item.unit)} ×{' '}
                {formatRupees(item.taxable_value / Math.max(item.qty, 1))}
                {'  ·  '}
                {item.gst_rate_snapshot}% GST
              </Text>
            </View>
            <Text style={styles.itemTotal}>{formatRupees(item.line_total)}</Text>
          </View>
        ))}

        <View style={styles.divider} />

        <View style={styles.totalRow}>
          <Text style={styles.muted}>Taxable value</Text>
          <Text style={styles.value}>{formatRupees(quotation.subtotal)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.muted}>GST</Text>
          <Text style={styles.value}>{formatRupees(quotation.gst_total)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.grandLabel}>Total</Text>
          <Text style={styles.grandValue}>{formatRupees(quotation.grand_total)}</Text>
        </View>

        <Text style={styles.hint}>
          The GST split into CGST/SGST or IGST is set on the invoice, from the customer’s state.
        </Text>
      </View>

      {converted ? (
        <Pressable
          style={({ pressed }) => [styles.linkCard, pressed && styles.linkCardPressed]}
          onPress={() =>
            router.push({
              pathname: '/bill/[id]',
              params: { id: String(quotation.converted_bill_id) },
            })
          }
          accessibilityRole="button"
          accessibilityLabel="Open the bill this quotation became">
          <Ionicons name="checkmark-circle" size={20} color={Colors.inStock} />
          <View style={styles.linkText}>
            <Text style={styles.linkTitle}>
              {convertedBill
                ? `Converted to ${convertedBill.invoice_number}`
                : 'Converted into a bill'}
            </Text>
            <Text style={styles.muted}>
              {quotation.converted_at ? formatDate(quotation.converted_at) : ''} — tap to open it
            </Text>
            {/* Said here rather than at the moment of editing: the two
                documents are separate from the moment the bill exists, and
                someone reading the quotation should know that before they
                change it, not after. */}
            <Text style={styles.muted}>
              Editing or deleting this quotation will not change that bill.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </Pressable>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.convertButton, pressed && styles.convertButtonPressed]}
          onPress={convert}
          accessibilityRole="button"
          accessibilityLabel="Load this quotation into a new bill">
          <Ionicons name="arrow-forward-circle" size={20} color="#FFFFFF" />
          <Text style={styles.convertButtonText}>Convert to Bill</Text>
        </Pressable>
      )}

      <Pressable
        style={({ pressed }) => [styles.shareButton, pressed && styles.shareButtonPressed]}
        onPress={share}
        disabled={sharing}
        accessibilityRole="button"
        accessibilityLabel="Share this quotation as a PDF">
        {sharing ? (
          <ActivityIndicator color={Colors.brand} />
        ) : (
          <Ionicons name="share-social-outline" size={20} color={Colors.brand} />
        )}
        <Text style={styles.shareButtonText}>{sharing ? 'Preparing…' : 'Share quotation'}</Text>
      </Pressable>

      <View style={styles.editRow}>
        <Pressable
          style={({ pressed }) => [
            styles.shareButton,
            styles.editRowButton,
            pressed && styles.shareButtonPressed,
          ]}
          onPress={() => {
            startEditingQuotation(quotation.id).catch((err: Error) => setError(err.message));
          }}
          accessibilityRole="button"
          accessibilityLabel="Edit this quotation">
          <Ionicons name="create-outline" size={20} color={Colors.brand} />
          <Text style={styles.shareButtonText}>Edit</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.dangerButton,
            styles.editRowButton,
            pressed && styles.shareButtonPressed,
          ]}
          onPress={() =>
            confirmDeleteQuotation(
              quotation,
              // Back to the list: this screen is showing something that no
              // longer exists.
              () => router.replace('/(tabs)/quotations'),
              setError
            )
          }
          accessibilityRole="button"
          accessibilityLabel="Delete this quotation">
          <Ionicons name="trash-outline" size={20} color={Colors.outOfStock} />
          <Text style={styles.dangerButtonText}>Delete</Text>
        </Pressable>
      </View>

      <ErrorBanner message={error} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: FontSizes.body, color: Colors.textMuted },
  card: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  headLeft: { flex: 1 },
  label: { fontSize: FontSizes.small, color: Colors.textMuted },
  reference: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  value: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  customerName: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  muted: { fontSize: FontSizes.small, color: Colors.textMuted },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.xs },
  itemMain: { flex: 1 },
  itemName: { fontSize: FontSizes.body, color: Colors.text },
  itemTotal: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grandLabel: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  grandValue: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  hint: { fontSize: FontSizes.small, color: Colors.textMuted, marginTop: Spacing.sm },
  convertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 12,
    backgroundColor: Colors.brand,
  },
  convertButtonPressed: { backgroundColor: Colors.brandDark },
  convertButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 12,
    backgroundColor: Colors.background,
  },
  linkCardPressed: { backgroundColor: Colors.surface },
  linkText: { flex: 1 },
  linkTitle: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.brand,
  },
  shareButtonPressed: { backgroundColor: Colors.background },
  shareButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.brand },
  editRow: { flexDirection: 'row', gap: Spacing.sm },
  editRowButton: { flex: 1 },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.outOfStock,
  },
  dangerButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.outOfStock },
});
