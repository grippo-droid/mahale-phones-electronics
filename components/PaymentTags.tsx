import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { isPaymentType, type PaidState } from '@/lib/payment';

/**
 * The payment tags on a bill row (T5.6).
 *
 * Same shape as `LowStockBadge`: a filled pill, white text, colour carrying the
 * meaning. Reused rather than reinvented so that a coloured pill means the same
 * kind of thing everywhere in the app.
 *
 * Two tags, because they answer different questions. The type says how the sale
 * was agreed and never changes; the status says where the money is and does.
 * They use different colour families on purpose — the type is a neutral fact
 * (grey, blue), the status is the one worth scanning a list for (green, amber).
 *
 * Not Paid is amber rather than red. An unpaid credit bill is ordinary business
 * to be chased, not a fault; red is reserved for things that are wrong, like
 * oversold stock.
 *
 * Where the status tag can be tapped it has to LOOK tappable, or it reads as
 * decoration sitting beside a genuinely read-only type tag. Two things say so:
 * a small arrows icon inside the pill, and a press state. The icon is the part
 * that works before anyone touches it — a press state is only discoverable by
 * pressing, which is no help to someone wondering whether they may.
 */

const PAID_COLOURS: Record<Exclude<PaidState, 'unknown'>, string> = {
  paid: Colors.inStock,
  partial: Colors.lowStock,
  unpaid: Colors.lowStock,
};

type Props = {
  paymentType: string | null;
  /** Computed from the bill's ledger, never stored — see `lib/payment.ts`. */
  state: PaidState;
  /**
   * Makes the status tag tappable. Omitted where the tags are only being read —
   * the bill screen, where a bill opened on its own is being looked at rather
   * than processed. History and the Dashboard both pass it, because both are
   * lists the owner works through with payments in hand.
   */
  onTogglePaid?: () => void;
  /** Set while a toggle is being written, so it cannot be tapped twice. */
  busy?: boolean;
};

export default function PaymentTags({ paymentType, state, onTogglePaid, busy }: Props) {
  // A bill from before this feature existed has neither. Rendering nothing at
  // all is the honest option — see the note on the unknown status below.
  if (!isPaymentType(paymentType) && state === 'unknown' && !onTogglePaid) return null;

  return (
    <View style={styles.row}>
      {isPaymentType(paymentType) ? (
        <View
          style={[
            styles.tag,
            { backgroundColor: paymentType === 'Credit' ? Colors.brand : Colors.textMuted },
          ]}
          accessibilityLabel={`${paymentType} sale`}>
          <Text style={styles.tagText}>{paymentType}</Text>
        </View>
      ) : null}

      <PaidTag state={state} onToggle={onTogglePaid} busy={busy} />
    </View>
  );
}

/**
 * The status tag, in three states.
 *
 * `unknown` is not "unpaid". Bills raised before this feature have no status
 * recorded, and showing them as unpaid would put a debt on the books that
 * nobody ever entered. It renders as an outlined pill reading "Not recorded" —
 * outlined rather than filled so it reads as an absence rather than a state,
 * and still tappable where a toggle is offered, so an old bill can be
 * classified rather than being stuck outside the feature forever.
 */
function PaidTag({
  state,
  onToggle,
  busy,
}: {
  state: PaidState;
  onToggle?: () => void;
  busy?: boolean;
}) {
  if (state === 'unknown' && !onToggle) return null;

  const label =
    state === 'paid'
      ? 'Paid'
      : state === 'partial'
        ? 'Part paid'
        : state === 'unpaid'
          ? 'Not Paid'
          : 'Not recorded';

  const interactive = Boolean(onToggle);

  const body = (pressed: boolean) =>
    state === 'unknown' ? (
      <View
        style={[
          styles.tag,
          styles.tagOutline,
          busy && styles.tagBusy,
          pressed && styles.tagPressed,
        ]}>
        <Text style={[styles.tagText, styles.tagOutlineText]}>{label}</Text>
        {interactive ? (
          <Ionicons name="swap-horizontal" size={11} color={Colors.textMuted} />
        ) : null}
      </View>
    ) : state === 'partial' ? (
      // Amber like Not Paid, because some money is still owed and that is the
      // same kind of thing to chase — but tinted and outlined rather than
      // filled, so "some of it has arrived" is readable without stopping to
      // read. Two solid ambers side by side in a list are not tellable apart.
      <View
        style={[
          styles.tag,
          styles.tagPartial,
          busy && styles.tagBusy,
          pressed && styles.tagPressed,
        ]}>
        <Text style={[styles.tagText, styles.tagPartialText]}>{label}</Text>
        {interactive ? (
          <Ionicons name="swap-horizontal" size={11} color={Colors.lowStock} />
        ) : null}
      </View>
    ) : (
      <View
        style={[
          styles.tag,
          { backgroundColor: PAID_COLOURS[state] },
          busy && styles.tagBusy,
          pressed && styles.tagPressed,
        ]}>
        <Text style={styles.tagText}>{label}</Text>
        {interactive ? <Ionicons name="swap-horizontal" size={11} color="#FFFFFF" /> : null}
      </View>
    );

  if (!onToggle) return body(false);

  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      hitSlop={Spacing.sm}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      accessibilityLabel={
        state === 'paid'
          ? 'Paid. Tap to see the payments recorded.'
          : state === 'partial'
            ? 'Part paid. Tap to record the rest.'
            : state === 'unpaid'
              ? 'Not paid. Tap to record payment in full.'
              : 'Payment not recorded. Tap to record payment in full.'
      }>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
    alignSelf: 'flex-start',
  },
  // Dimmed and slightly inset, so a tap reads as a press rather than as the
  // tag having changed to some third state.
  tagPressed: { opacity: 0.65 },
  tagOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border,
    // Matches the filled pills' height despite the border taking a pixel.
    paddingVertical: 2,
  },
  tagPartial: {
    backgroundColor: Colors.lowStockTint,
    borderWidth: 1,
    borderColor: Colors.lowStock,
    paddingVertical: 2,
  },
  tagPartialText: { color: Colors.lowStock },
  tagBusy: { opacity: 0.5 },
  tagText: { color: '#FFFFFF', fontSize: FontSizes.small - 2, fontWeight: '700' },
  tagOutlineText: { color: Colors.textMuted },
});
