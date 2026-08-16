import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { formatRupees } from '@/lib/format';
import { calculateBill, summariseByRate, type SupplyType } from '@/lib/gst';
import type { CartLine } from '@/store/cart';

/**
 * The live tax and total panel for the bill in progress (T3.5).
 *
 * Shows what the invoice will show, in the order the invoice shows it: taxable
 * value broken down by GST rate, then the tax heads, then the rounding, then the
 * grand total. A GST invoice has to carry a rate-wise summary rather than one
 * combined tax figure, because a single bill can mix 12%, 18% and 28% items —
 * so this panel is not just a nicety, it is a preview of a legal requirement.
 *
 * It lives on the customer step because the CGST/SGST-versus-IGST split is
 * decided by the customer's state: picking the state and seeing the split change
 * belongs on one screen. Until a state is picked the panel says what it does not
 * yet know rather than showing a breakdown that might be wrong.
 */

type Props = {
  lines: CartLine[];
  /** Null until the customer's state is known — see `resolveSupplyType`. */
  supplyType: SupplyType | null;
  /**
   * Product ids still on the bill that have no HSN code. Surfaced here because
   * an incomplete HSN reaches the customer's invoice, and flagging it only on
   * the Inventory list would mean it is never seen by whoever raises the bill.
   */
  missingHsnNames: string[];
};

/** Matches the Billing screen: a stand-in only, never presented as the price. */
const PROVISIONAL_SUPPLY_TYPE: SupplyType = 'intra-state';

export default function GstSummary({ lines, supplyType, missingHsnNames }: Props) {
  const result = useMemo(
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
      ),
    [lines, supplyType]
  );

  const byRate = useMemo(() => summariseByRate(result.lines), [result.lines]);
  const { totals } = result;
  const intra = (supplyType ?? PROVISIONAL_SUPPLY_TYPE) === 'intra-state';

  if (lines.length === 0) return null;

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Bill summary</Text>

      {/* Rate-wise, as it will appear on the invoice. Only shown once the split
          is real — a rate-wise table is the most authoritative-looking thing on
          the panel and the worst thing to show provisionally. */}
      {supplyType ? (
        <View style={styles.rateTable}>
          <View style={[styles.rateRow, styles.rateHeaderRow]}>
            <Text style={[styles.rateCell, styles.rateHeader, styles.rateCellRate]}>Rate</Text>
            <Text style={[styles.rateCell, styles.rateHeader, styles.rateCellNumber]}>Taxable</Text>
            <Text style={[styles.rateCell, styles.rateHeader, styles.rateCellNumber]}>
              {intra ? 'CGST' : 'IGST'}
            </Text>
            {intra ? (
              <Text style={[styles.rateCell, styles.rateHeader, styles.rateCellNumber]}>SGST</Text>
            ) : null}
          </View>

          {byRate.map((row) => (
            <View key={row.gstRate} style={styles.rateRow}>
              <Text style={[styles.rateCell, styles.rateCellRate]}>{row.gstRate}%</Text>
              <Text style={[styles.rateCell, styles.rateCellNumber]}>
                {formatRupees(row.taxableValue)}
              </Text>
              <Text style={[styles.rateCell, styles.rateCellNumber]}>
                {formatRupees(intra ? row.cgstAmount : row.igstAmount)}
              </Text>
              {intra ? (
                <Text style={[styles.rateCell, styles.rateCellNumber]}>
                  {formatRupees(row.sgstAmount)}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.lines}>
        <Row label="Taxable value" value={formatRupees(totals.subtotal)} />

        {supplyType ? (
          intra ? (
            <>
              <Row label="CGST" value={formatRupees(totals.cgstTotal)} />
              <Row label="SGST" value={formatRupees(totals.sgstTotal)} />
            </>
          ) : (
            <Row label="IGST" value={formatRupees(totals.igstTotal)} />
          )
        ) : (
          <View style={styles.pending}>
            <Ionicons name="information-circle" size={16} color={Colors.textMuted} />
            <Text style={styles.pendingText}>
              Pick the customer’s state above to see the CGST/SGST or IGST split.
            </Text>
          </View>
        )}

        {supplyType ? <Row label="Total tax" value={formatRupees(totals.totalTax)} /> : null}

        {/* Always shown when it is not zero, never hidden. Reverse-calculating
            tax out of an MRP lands a paisa or two off the marked price, and the
            customer is entitled to see where the difference went. */}
        {totals.roundOff !== 0 ? (
          <Row
            label="Round off"
            value={`${totals.roundOff > 0 ? '+' : '−'}${formatRupees(Math.abs(totals.roundOff)).slice(1)}`}
            muted
          />
        ) : null}
      </View>

      <View style={styles.grandRow}>
        <Text style={styles.grandLabel}>Grand total</Text>
        <View style={styles.grandRight}>
          <Text style={styles.grandValue}>{formatRupees(totals.grandTotal)}</Text>
          {!supplyType ? (
            <Text style={styles.grandNote}>approximate until the state is set</Text>
          ) : null}
        </View>
      </View>

      {/* Carried over from Phase 2 deliberately: an HSN code missing on a
          product is an inventory problem there, but here it is about to be
          printed on a customer's GST invoice. */}
      {missingHsnNames.length > 0 ? (
        <View style={styles.hsnWarning}>
          <Ionicons name="warning" size={16} color={Colors.lowStock} />
          <Text style={styles.hsnWarningText}>
            {missingHsnNames.length === 1
              ? `${missingHsnNames[0]} has no HSN code.`
              : `${missingHsnNames.length} items have no HSN code: ${missingHsnNames.join(', ')}.`}{' '}
            A GST invoice is supposed to carry one. The bill can still be
            generated — add the code on the Inventory tab to fix it properly.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowMuted]}>{label}</Text>
      <Text style={[styles.rowValue, muted && styles.rowMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    margin: Spacing.md,
    padding: Spacing.md,
    gap: Spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  heading: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },

  rateTable: { gap: Spacing.xs },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rateHeaderRow: { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: Spacing.xs },
  rateCell: { fontSize: FontSizes.small, color: Colors.text, fontVariant: ['tabular-nums'] },
  rateHeader: { color: Colors.textMuted, fontWeight: '700' },
  rateCellRate: { width: 44 },
  rateCellNumber: { flex: 1, textAlign: 'right' },

  lines: { gap: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: FontSizes.body, color: Colors.text },
  rowValue: { fontSize: FontSizes.body, color: Colors.text, fontVariant: ['tabular-nums'] },
  rowMuted: { color: Colors.textMuted, fontSize: FontSizes.small },

  pending: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, paddingVertical: Spacing.xs },
  pendingText: { flex: 1, fontSize: FontSizes.small, color: Colors.textMuted },

  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  grandLabel: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  grandRight: { alignItems: 'flex-end' },
  grandValue: {
    fontSize: FontSizes.title,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  grandNote: { fontSize: FontSizes.small - 3, color: Colors.textMuted },

  hsnWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  hsnWarningText: { flex: 1, fontSize: FontSizes.small, color: Colors.lowStock },
});
