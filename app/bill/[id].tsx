import Ionicons from '@expo/vector-icons/Ionicons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
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

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { stateCodeFor } from '@/constants/states';
import { getBillById, setBillPdfPath, type BillWithItems } from '@/db/bills';
import { formatDate, formatRupees } from '@/lib/format';
import { rupeesInWords } from '@/lib/numberToWords';
import {
  buildBillHtml,
  existingBillPdf,
  generateBillPdf,
  isInterStateBill,
  summariseStoredItems,
} from '@/lib/pdf';
import { selectBusiness, useSettingsStore } from '@/store/settings';

/**
 * Bill Result / Preview (T4.3).
 *
 * Reached straight after generating a bill, and again from History (T5.6).
 *
 * ---------------------------------------------------------------------------
 * Why the preview on this screen is drawn natively rather than showing the PDF.
 *
 * Android's WebView cannot display a PDF on its own, and this app is
 * offline-first so a remote viewer (Google Docs, etc.) is not an option. The
 * honest choices were to add a PDF-rendering dependency, or to draw the bill
 * with the same stored figures the PDF is built from.
 *
 * Drawing it natively wins on the thing that matters at a counter: it appears
 * instantly, works with no network, and is readable on a phone without pinching
 * at an A4 page. The printed page is one tap away through the system print
 * sheet, which renders the real thing — that is the button below, and it is
 * where the printed layout should be checked.
 *
 * Both come from the same `bills`/`bill_items` rows, so they cannot disagree.
 * ---------------------------------------------------------------------------
 *
 * Sharing (T4.4) needs a real file, so that path does render the PDF through
 * `generateBillPdf` and records it on the bill.
 *
 * There is no Bluetooth thermal printing and there will not be — see CLAUDE.md.
 * "Open printable bill" hands the same PDF to the Android print sheet, which is
 * the whole of the printing story here.
 */

export default function BillResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const business = useSettingsStore(selectBusiness);

  const [bill, setBill] = useState<BillWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const billId = Number.parseInt(id ?? '', 10);

  useEffect(() => {
    let cancelled = false;

    if (!Number.isInteger(billId)) {
      setError('That bill could not be found.');
      setLoading(false);
      return;
    }

    getBillById(billId)
      .then((found) => {
        if (cancelled) return;
        if (!found) setError('That bill could not be found.');
        setBill(found);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [billId]);

  /**
   * Produces the PDF file, reusing one already on disk (T4.4).
   *
   * Sharing needs a real file, unlike printing — so this is where
   * `generateBillPdf` is used, and where the resulting path is recorded on the
   * bill so History can share it again without rendering a second time.
   */
  const preparePdf = useCallback(async (): Promise<string | null> => {
    if (!bill) return null;

    // A bill reopened from History already has one; a freshly generated bill
    // may still have the file from a previous share.
    const existing = bill.pdf_path ?? existingBillPdf(bill.invoice_number);
    if (existing) return existing;

    const path = await generateBillPdf(bill, business);
    await setBillPdfPath(bill.id, path);
    // Keep the in-memory bill in step, so a second share skips the render.
    setBill((current) => (current ? { ...current, pdf_path: path } : current));
    return path;
  }, [bill, business]);

  const shareBill = useCallback(async () => {
    if (!bill) return;

    setSharing(true);
    setPdfError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing is not available', 'This device cannot open a share sheet.');
        return;
      }

      const path = await preparePdf();
      if (!path) return;

      await Sharing.shareAsync(path, {
        mimeType: 'application/pdf',
        // Android names the chooser from this; iOS uses the UTI. Neither is
        // the filename — that comes from the file itself, which is why it is
        // saved as MPE-2026-27-0001.pdf rather than a random cache name.
        dialogTitle: `Bill ${bill.invoice_number}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The bill exists either way; only the copy of it failed.
      setPdfError(`The bill is saved, but it could not be shared: ${message}`);
    } finally {
      setSharing(false);
    }
  }, [bill, preparePdf]);

  /**
   * Opens the Android print sheet, which renders the bill for preview and can
   * print it or save it as a PDF.
   *
   * Printed from HTML rather than from the generated file: expo-print's Android
   * `{ uri }` path double-resumes its coroutine on any failure, which surfaces
   * as an uncaught native crash instead of an error this screen could show. See
   * `buildBillHtml`. The rendered output is the same either way.
   */
  const openPdf = useCallback(async () => {
    if (!bill) return;

    setPreparingPdf(true);
    setPdfError(null);
    try {
      const html = await buildBillHtml(bill, business);
      await Print.printAsync({ html, width: 595, height: 842 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Could not open the bill', message);
      setPdfError(`The bill is saved, but it could not be opened for printing: ${message}`);
    } finally {
      setPreparingPdf(false);
    }
  }, [bill, business]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  if (error || !bill) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle" size={44} color={Colors.outOfStock} />
        <Text style={styles.errorTitle}>{error ?? 'That bill could not be found.'}</Text>
        <Pressable style={styles.secondaryButton} onPress={() => router.replace('/dashboard')}>
          <Text style={styles.secondaryButtonText}>Back to dashboard</Text>
        </Pressable>
      </View>
    );
  }

  const interState = isInterStateBill(bill, business.state);
  const rateRows = summariseStoredItems(bill.items);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.savedBanner}>
          <Ionicons name="checkmark-circle" size={22} color={Colors.inStock} />
          <Text style={styles.savedText}>Bill saved</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.invoiceHead}>
            <View style={styles.invoiceHeadLeft}>
              <Text style={styles.label}>Invoice No.</Text>
              <Text style={styles.invoiceNumber}>{bill.invoice_number}</Text>
            </View>
            <View>
              <Text style={styles.label}>Date</Text>
              <Text style={styles.value}>{formatDate(bill.date)}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <Text style={styles.label}>Billed to</Text>
          <Text style={styles.customerName}>{bill.customer_name}</Text>
          {bill.customer_address ? (
            <Text style={styles.muted}>{bill.customer_address}</Text>
          ) : null}
          <Text style={styles.muted}>{bill.customer_phone}</Text>
          {bill.customer_gstin ? (
            <Text style={styles.gstin}>GSTIN: {bill.customer_gstin}</Text>
          ) : null}
          <Text style={styles.muted}>
            {bill.customer_state}
            {stateCodeFor(bill.customer_state) ? ` (${stateCodeFor(bill.customer_state)})` : ''}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Items</Text>
          {bill.items.map((item, index) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemMain}>
                <Text style={styles.itemName}>
                  {index + 1}. {item.product_name_snapshot}
                </Text>
                <Text style={styles.muted}>
                  {item.qty} × {formatRupees(item.taxable_value / Math.max(item.qty, 1))}
                  {'  ·  '}
                  {item.gst_rate_snapshot}% GST
                  {item.hsn_code_snapshot ? `  ·  HSN ${item.hsn_code_snapshot}` : ''}
                </Text>
              </View>
              <Text style={styles.itemTotal}>{formatRupees(item.line_total)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tax summary</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colRate]}>Rate</Text>
            <Text style={[styles.th, styles.colNum]}>Taxable</Text>
            <Text style={[styles.th, styles.colNum]}>{interState ? 'IGST' : 'CGST'}</Text>
            {!interState ? <Text style={[styles.th, styles.colNum]}>SGST</Text> : null}
          </View>
          {rateRows.map((row) => (
            <View key={row.gstRate} style={styles.tableRow}>
              <Text style={[styles.td, styles.colRate]}>{row.gstRate}%</Text>
              <Text style={[styles.td, styles.colNum]}>{row.taxableValue.toFixed(2)}</Text>
              <Text style={[styles.td, styles.colNum]}>
                {(interState ? row.igstAmount : row.cgstAmount).toFixed(2)}
              </Text>
              {!interState ? (
                <Text style={[styles.td, styles.colNum]}>{row.sgstAmount.toFixed(2)}</Text>
              ) : null}
            </View>
          ))}

          <View style={styles.divider} />

          <TotalRow label="Taxable value" value={formatRupees(bill.subtotal)} />
          {interState ? (
            <TotalRow label="IGST" value={formatRupees(bill.igst_total)} />
          ) : (
            <>
              <TotalRow label="CGST" value={formatRupees(bill.cgst_total)} />
              <TotalRow label="SGST" value={formatRupees(bill.sgst_total)} />
            </>
          )}
          {bill.round_off !== 0 ? (
            <TotalRow
              label="Round off"
              value={`${bill.round_off > 0 ? '+' : '−'}${formatRupees(Math.abs(bill.round_off)).slice(1)}`}
              muted
            />
          ) : null}

          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Grand total</Text>
            <Text style={styles.grandValue}>{formatRupees(bill.grand_total)}</Text>
          </View>

          <Text style={styles.words}>{rupeesInWords(bill.grand_total)}</Text>
        </View>

        {pdfError ? (
          <View style={styles.pdfError}>
            <Ionicons name="warning" size={16} color={Colors.lowStock} />
            <Text style={styles.pdfErrorText}>{pdfError}</Text>
          </View>
        ) : null}

      </ScrollView>

      <View style={styles.actions}>
        {/* Share is the primary action: most bills go to the customer on
            WhatsApp, and printing is the exception at this counter. */}
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            sharing && styles.busy,
          ]}
          onPress={shareBill}
          disabled={sharing}
          accessibilityRole="button"
          accessibilityLabel="Share this bill">
          {sharing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Ionicons name="share-social" size={20} color="#FFFFFF" />
          )}
          <Text style={styles.primaryButtonText}>
            {sharing ? 'Preparing…' : 'Share bill'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.outlineButton,
            pressed && styles.secondaryButtonPressed,
            preparingPdf && styles.busy,
          ]}
          onPress={openPdf}
          disabled={preparingPdf}
          accessibilityRole="button"
          accessibilityLabel="Open the printable bill">
          {preparingPdf ? (
            <ActivityIndicator color={Colors.brand} />
          ) : (
            <Ionicons name="print" size={20} color={Colors.brand} />
          )}
          <Text style={styles.outlineButtonText}>
            {preparingPdf ? 'Preparing…' : 'Print'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
          onPress={() => router.replace('/dashboard')}
          accessibilityRole="button"
          accessibilityLabel="Done, back to the dashboard">
          <Text style={styles.secondaryButtonText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

function TotalRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, muted && styles.totalMuted]}>{label}</Text>
      <Text style={[styles.totalValue, muted && styles.totalMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.lg },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },
  errorTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text, textAlign: 'center' },

  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 8,
    backgroundColor: '#E8F5E9',
  },
  savedText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.inStock },

  card: {
    gap: Spacing.xs,
    padding: Spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  invoiceHead: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  invoiceHeadLeft: { flex: 1 },
  label: { fontSize: FontSizes.small - 1, color: Colors.textMuted, textTransform: 'uppercase' },
  invoiceNumber: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.brand },
  value: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
  customerName: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  muted: { fontSize: FontSizes.small, color: Colors.textMuted },
  gstin: { fontSize: FontSizes.small, fontWeight: '700', color: Colors.text },

  sectionTitle: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text, marginBottom: Spacing.xs },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  itemMain: { flex: 1, gap: 2 },
  itemName: { fontSize: FontSizes.body, color: Colors.text, fontWeight: '600' },
  itemTotal: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },

  tableHeader: { flexDirection: 'row', gap: Spacing.sm, paddingBottom: Spacing.xs },
  tableRow: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 2 },
  th: { fontSize: FontSizes.small - 1, color: Colors.textMuted, fontWeight: '700' },
  td: { fontSize: FontSizes.small, color: Colors.text, fontVariant: ['tabular-nums'] },
  colRate: { width: 48 },
  colNum: { flex: 1, textAlign: 'right' },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalLabel: { fontSize: FontSizes.body, color: Colors.text },
  totalValue: { fontSize: FontSizes.body, color: Colors.text, fontVariant: ['tabular-nums'] },
  totalMuted: { color: Colors.textMuted, fontSize: FontSizes.small },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  grandLabel: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  grandValue: {
    fontSize: FontSizes.title,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  words: { fontSize: FontSizes.small, fontStyle: 'italic', color: Colors.textMuted, marginTop: Spacing.xs },

  pdfError: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  pdfErrorText: { flex: 1, fontSize: FontSizes.small, color: Colors.lowStock },

  actions: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: Spacing.minTapTarget + 4,
    borderRadius: 8,
    backgroundColor: Colors.brand,
  },
  primaryButtonPressed: { backgroundColor: Colors.brandDark },
  primaryButtonText: { color: '#FFFFFF', fontSize: FontSizes.body, fontWeight: '700' },
  busy: { opacity: 0.7 },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: Spacing.minTapTarget + 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.brand,
  },
  outlineButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.brand },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: Spacing.minTapTarget,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryButtonPressed: { backgroundColor: Colors.surface },
  secondaryButtonText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
});
