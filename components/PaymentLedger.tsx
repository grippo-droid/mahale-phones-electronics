import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import type { BillPayment, NewPayment } from '@/db/payments';
import { formatDate, formatRupees } from '@/lib/format';
import {
  formatPaymentDate,
  parsePaymentAmount,
  parsePaymentDate,
  paymentTotalsFor,
} from '@/lib/payment';

/**
 * What has been received against a bill, and the way to change it (T9.2).
 *
 * A ledger rather than a flag, because a customer paying half now and half next
 * week is ordinary and two states could not say it. Every entry is editable and
 * deletable: the owner is fixing a figure they mistyped a minute ago, not
 * keeping double-entry books, and a correcting entry for each slip would make
 * the list unreadable on a phone. `edited_at` records that it happened.
 *
 * Overpayment warns and never blocks, the same way overselling stock does. A
 * customer rounding up, or a deposit against the next order, is a real thing
 * that happens at a counter, and an app that refuses to record what actually
 * came in is an app that stops being used.
 */

type Props = {
  grandTotal: number;
  payments: BillPayment[];
  onRecord: (payment: NewPayment) => Promise<void>;
  onEdit: (paymentId: number, payment: NewPayment) => Promise<void>;
  onDelete: (payment: BillPayment) => Promise<void>;
  busy?: boolean;
};

function todayText(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
}

export default function PaymentLedger({
  grandTotal,
  payments,
  onRecord,
  onEdit,
  onDelete,
  busy,
}: Props) {
  const [editing, setEditing] = useState<BillPayment | 'new' | null>(null);
  const [amountText, setAmountText] = useState('');
  const [dateText, setDateText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const totals = paymentTotalsFor(
    grandTotal,
    payments.map((payment) => payment.amount)
  );

  const openNew = () => {
    setEditing('new');
    // Pre-filled with what is still owed: the commonest payment by far is the
    // one that settles the bill, and the owner can type over it.
    setAmountText(totals.outstanding > 0 ? String(totals.outstanding) : '');
    setDateText(todayText());
    setFormError(null);
  };

  const openEdit = (payment: BillPayment) => {
    setEditing(payment);
    setAmountText(String(payment.amount));
    setDateText(payment.paid_on ? formatPaymentDate(payment.paid_on) : todayText());
    setFormError(null);
  };

  const save = async () => {
    const amount = parsePaymentAmount(amountText);
    if (amount === null) {
      setFormError('Enter an amount greater than zero.');
      return;
    }

    const paidOn = parsePaymentDate(dateText);
    if (paidOn === null) {
      setFormError('Enter the date as dd/mm/yyyy.');
      return;
    }

    // The figure this entry would make the ledger come to.
    // What the ledger would come to with this entry applied. An edit replaces
    // its own row rather than adding to it.
    const others = payments
      .filter((payment) => editing === 'new' || payment.id !== editing?.id)
      .map((payment) => payment.amount);
    const wouldTotal = [...others, amount];

    const proceed = async () => {
      setSaving(true);
      setFormError(null);
      try {
        if (editing === 'new') await onRecord({ amount, paid_on: paidOn });
        else if (editing) await onEdit(editing.id, { amount, paid_on: paidOn });
        setEditing(null);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    };

    const over = paymentTotalsFor(grandTotal, wouldTotal).overpaidBy;
    if (over > 0) {
      // Warned, not blocked — see the note at the top.
      Alert.alert(
        'More than the bill',
        `That would make ${formatRupees(
          paymentTotalsFor(grandTotal, wouldTotal).paidAmount
        )} received against a bill of ${formatRupees(grandTotal)} — ${formatRupees(
          over
        )} more than is owed.\n\nRecord it anyway?`,
        [
          { text: 'Go back', style: 'cancel' },
          { text: 'Record it', onPress: () => void proceed() },
        ]
      );
      return;
    }

    await proceed();
  };

  const confirmDelete = (payment: BillPayment) => {
    Alert.alert(
      'Remove this payment?',
      `${formatRupees(payment.amount)}${
        payment.paid_on ? ` on ${formatDate(payment.paid_on)}` : ''
      } will be taken off this bill, and the bill's status will be worked out again.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void onDelete(payment) },
      ]
    );
  };

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Payments</Text>
        <Text style={styles.summary}>
          {formatRupees(totals.paidAmount)} of {formatRupees(grandTotal)}
        </Text>
      </View>

      {totals.outstanding > 0 ? (
        <Text style={styles.outstanding}>{formatRupees(totals.outstanding)} still owed</Text>
      ) : totals.overpaidBy > 0 ? (
        <Text style={styles.outstanding}>
          {formatRupees(totals.overpaidBy)} more than the bill
        </Text>
      ) : payments.length > 0 ? (
        <Text style={styles.settled}>Settled in full</Text>
      ) : null}

      {payments.length === 0 ? (
        <Text style={styles.empty}>
          Nothing recorded yet. Add a payment as the money comes in — it can come in parts.
        </Text>
      ) : (
        payments.map((payment) => (
          <View key={payment.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowAmount}>{formatRupees(payment.amount)}</Text>
              <Text style={styles.rowDate}>
                {/* NULL only for entries migration 010 created, from a bill
                    already marked paid before the ledger existed. The amount
                    was knowable; the date was never recorded, and inventing
                    one would print a date nobody entered. */}
                {payment.paid_on ? formatDate(payment.paid_on) : 'Date not recorded'}
                {payment.edited_at ? ' · edited' : ''}
              </Text>
            </View>

            <Pressable
              onPress={() => openEdit(payment)}
              disabled={busy}
              hitSlop={Spacing.sm}
              style={styles.rowButton}
              accessibilityRole="button"
              accessibilityLabel={`Change this payment of ${formatRupees(payment.amount)}`}>
              <Ionicons name="pencil" size={18} color={Colors.brand} />
            </Pressable>

            <Pressable
              onPress={() => confirmDelete(payment)}
              disabled={busy}
              hitSlop={Spacing.sm}
              style={styles.rowButton}
              accessibilityRole="button"
              accessibilityLabel={`Remove this payment of ${formatRupees(payment.amount)}`}>
              <Ionicons name="trash-outline" size={18} color={Colors.outOfStock} />
            </Pressable>
          </View>
        ))
      )}

      <Pressable
        style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
        onPress={openNew}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Record a payment against this bill">
        <Ionicons name="add" size={18} color={Colors.brand} />
        <Text style={styles.addButtonText}>Record a payment</Text>
      </Pressable>

      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {editing === 'new' ? 'Record a payment' : 'Change this payment'}
            </Text>

            <Text style={styles.fieldLabel}>Amount received</Text>
            <TextInput
              style={styles.input}
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
              accessibilityLabel="Amount received"
            />

            <Text style={styles.fieldLabel}>Date received</Text>
            <TextInput
              style={styles.input}
              value={dateText}
              onChangeText={setDateText}
              keyboardType="numbers-and-punctuation"
              placeholder="dd/mm/yyyy"
              placeholderTextColor={Colors.textMuted}
              accessibilityLabel="Date received, as day slash month slash year"
            />

            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
              onPress={() => void save()}
              disabled={saving}
              accessibilityRole="button">
              <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
              onPress={() => setEditing(null)}
              disabled={saving}
              accessibilityRole="button">
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  heading: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  summary: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.text },
  outstanding: { fontSize: FontSizes.small, color: Colors.lowStock, fontWeight: '600' },
  settled: { fontSize: FontSizes.small, color: Colors.inStock, fontWeight: '600' },
  empty: { fontSize: FontSizes.small, color: Colors.textMuted },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  rowText: { flex: 1 },
  rowAmount: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  rowDate: { fontSize: FontSizes.small, color: Colors.textMuted },
  rowButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: Spacing.minTapTarget,
    minHeight: Spacing.minTapTarget,
  },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.brand,
  },
  addButtonPressed: { backgroundColor: Colors.brandTint },
  addButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.brand },

  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  card: { width: '100%', gap: Spacing.xs, padding: Spacing.lg, borderRadius: 12, backgroundColor: Colors.background },
  cardTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  fieldLabel: { fontSize: FontSizes.small, color: Colors.textMuted, marginTop: Spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    fontSize: FontSizes.body,
    color: Colors.text,
  },
  formError: { fontSize: FontSizes.small, color: Colors.outOfStock, marginTop: Spacing.xs },

  primary: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderRadius: 10,
    backgroundColor: Colors.brand,
  },
  primaryPressed: { backgroundColor: Colors.brandDark },
  primaryText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: Spacing.minTapTarget, borderRadius: 10 },
  secondaryPressed: { backgroundColor: Colors.surface },
  secondaryText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.textMuted },
});
