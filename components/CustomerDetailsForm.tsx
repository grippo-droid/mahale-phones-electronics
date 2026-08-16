import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import StatePicker from '@/components/StatePicker';
import {
  gstinStateMismatch,
  isPlaceholderState,
  resolveSupplyType,
  validateCustomer,
  type Customer,
  type CustomerField,
} from '@/lib/customer';
import { parseGstin } from '@/lib/gstin';

/**
 * Step 2 of billing: who the bill is for (T3.4).
 *
 * Name, phone and state are required; address and GSTIN are optional. Only the
 * required three can block the bill — see `lib/customer.ts` for why a bad GSTIN
 * warns instead.
 *
 * Errors are shown only for fields that have been touched, so a form that has
 * not been filled in yet is not already covered in red. Warnings show as soon as
 * they are true, because they are about something that has been typed.
 */

type Props = {
  customer: Customer;
  onChangeField: (field: CustomerField, value: string) => void;
  /** Fields the user has interacted with — controls when errors appear. */
  touched: Partial<Record<CustomerField, boolean>>;
  onBlurField: (field: CustomerField) => void;
  /**
   * The shop's own state, from the settings store rather than the constants
   * file — it is editable in Settings from T4.1, and this is what the
   * customer's state is compared against to pick the tax heads.
   */
  businessState: string;
  /** Forces every error into view, for when "Generate Bill" is pressed (T3.6). */
  showAllErrors?: boolean;
};

export default function CustomerDetailsForm({
  customer,
  onChangeField,
  touched,
  onBlurField,
  businessState,
  showAllErrors = false,
}: Props) {
  const validation = useMemo(
    () => validateCustomer(customer, businessState),
    [customer, businessState]
  );

  const errorFor = (field: CustomerField): string | null => {
    if (!showAllErrors && !touched[field]) return null;
    return validation.errors.find((issue) => issue.field === field)?.message ?? null;
  };

  const warningsFor = (field: CustomerField) =>
    validation.warnings.filter((issue) => issue.field === field);

  const gstin = parseGstin(customer.gstin);
  const mismatch = gstinStateMismatch(customer);
  const supplyType = resolveSupplyType(customer.state, businessState);
  const homeState = isPlaceholderState(businessState) ? null : businessState;

  return (
    <View style={styles.form}>
      <Field
        label="Customer name"
        required
        value={customer.name}
        onChangeText={(text) => onChangeField('name', text)}
        onBlur={() => onBlurField('name')}
        placeholder="Full name"
        autoCapitalize="words"
        error={errorFor('name')}
      />

      <Field
        label="Phone"
        required
        value={customer.phone}
        onChangeText={(text) => onChangeField('phone', text)}
        onBlur={() => onBlurField('phone')}
        placeholder="10-digit mobile number"
        keyboardType="phone-pad"
        error={errorFor('phone')}
        warnings={warningsFor('phone')}
      />

      <StatePicker
        label="State *"
        value={customer.state}
        onChange={(state) => {
          onChangeField('state', state);
          onBlurField('state');
        }}
        homeState={homeState}
        error={errorFor('state')}
      />

      {/* What the chosen state means for tax, stated plainly. The shop owner
          should not have to know the rule to see that it has been applied. */}
      {supplyType ? (
        <View style={styles.supplyNote}>
          <Ionicons
            name={supplyType === 'intra-state' ? 'home' : 'swap-horizontal'}
            size={16}
            color={Colors.brand}
          />
          <Text style={styles.supplyText}>
            {supplyType === 'intra-state'
              ? 'Same state as the shop — this bill will be CGST + SGST.'
              : `Different state from the shop — this bill will be IGST.`}
          </Text>
        </View>
      ) : null}

      {warningsFor('state').map((issue) => (
        <Warning key={issue.message} message={issue.message} />
      ))}

      <Field
        label="Address"
        value={customer.address}
        onChangeText={(text) => onChangeField('address', text)}
        onBlur={() => onBlurField('address')}
        placeholder="Optional"
        multiline
        error={errorFor('address')}
      />

      <View>
        <Field
          label="GSTIN"
          value={customer.gstin}
          onChangeText={(text) => onChangeField('gstin', text.toUpperCase())}
          onBlur={() => onBlurField('gstin')}
          placeholder="Optional — for a business customer"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={15}
          error={null}
          monospace
        />

        {/* A valid GSTIN is worth confirming out loud: it is the one field on
            the bill the customer cares about most, and it is read out by ear. */}
        {gstin.valid && gstin.state && !mismatch ? (
          <View style={styles.gstinOk}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.inStock} />
            <Text style={styles.gstinOkText}>Valid GSTIN — registered in {gstin.state.name}.</Text>
          </View>
        ) : null}

        {warningsFor('gstin').map((issue) => (
          <Warning key={issue.message} message={issue.message} />
        ))}

        {/* The cross-check has an obvious fix, so offer it rather than leaving
            the user to work out which of the two fields to go and change. */}
        {mismatch ? (
          <Pressable
            style={({ pressed }) => [styles.fixButton, pressed && styles.fixButtonPressed]}
            onPress={() => onChangeField('state', mismatch.gstinState.name)}
            accessibilityRole="button"
            accessibilityLabel={`Change the state to ${mismatch.gstinState.name}, as the GSTIN says`}>
            <Ionicons name="arrow-forward-circle" size={18} color={Colors.brand} />
            <Text style={styles.fixButtonText}>
              Change state to {mismatch.gstinState.name}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onBlur: () => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  warnings?: { message: string }[];
  multiline?: boolean;
  monospace?: boolean;
  keyboardType?: 'default' | 'phone-pad';
  autoCapitalize?: 'none' | 'words' | 'characters';
  autoCorrect?: boolean;
  maxLength?: number;
};

function Field({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  required = false,
  error = null,
  warnings = [],
  multiline = false,
  monospace = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoCorrect = true,
  maxLength,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          monospace && styles.inputMono,
          error ? styles.inputError : null,
        ]}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        multiline={multiline}
        maxLength={maxLength}
        accessibilityLabel={label}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {warnings.map((warning) => (
        <Warning key={warning.message} message={warning.message} />
      ))}
    </View>
  );
}

function Warning({ message }: { message: string }) {
  return (
    <View style={styles.warning}>
      <Ionicons name="warning" size={14} color={Colors.lowStock} />
      <Text style={styles.warningText}>{message}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  form: { padding: Spacing.md, gap: Spacing.md },
  field: { gap: Spacing.xs },
  label: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.textMuted },
  input: {
    minHeight: Spacing.minTapTarget,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    fontSize: FontSizes.body,
    color: Colors.text,
  },
  inputMultiline: { minHeight: Spacing.minTapTarget * 1.5, textAlignVertical: 'top' },
  inputMono: { letterSpacing: 1.5, fontWeight: '600' },
  inputError: { borderColor: Colors.outOfStock },
  error: { fontSize: FontSizes.small, color: Colors.outOfStock },

  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, paddingTop: Spacing.xs },
  warningText: { flex: 1, fontSize: FontSizes.small, color: Colors.lowStock },

  supplyNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  supplyText: { flex: 1, fontSize: FontSizes.small, color: Colors.brand, fontWeight: '600' },

  gstinOk: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingTop: Spacing.xs },
  gstinOkText: { flex: 1, fontSize: FontSizes.small, color: Colors.inStock, fontWeight: '600' },

  fixButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.brand,
    alignSelf: 'flex-start',
  },
  fixButtonPressed: { backgroundColor: Colors.surface },
  fixButtonText: { fontSize: FontSizes.small, color: Colors.brand, fontWeight: '700' },
});
