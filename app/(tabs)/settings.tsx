import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import StatePicker from '@/components/StatePicker';
import { businessStateGstinMismatch, type BusinessDetails } from '@/constants/business';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import type { BusinessSettingField } from '@/db/settings';
import { parseGstin } from '@/lib/gstin';
import { deleteLogo, replaceLogo } from '@/lib/logo';
import {
  INVOICE_FORMAT_TOKENS,
  INVOICE_RESET_POLICIES,
  previewInvoiceNumber,
  validateInvoiceNumberConfig,
  type InvoiceNumberConfig,
  type InvoiceResetPolicy,
} from '@/lib/invoiceNumber';
import {
  selectBusiness,
  selectInvoiceConfig,
  useSettingsStore,
} from '@/store/settings';

/**
 * Settings — the shop's own details (T4.1).
 *
 * These were compiled into `constants/business.ts`; from here they live in the
 * database, so they are editable on the phone and travel with a Phase 6 backup.
 * That file is now only the first-run defaults.
 *
 * Two checks run here rather than being left to whoever reads the bill later:
 *
 *   - The GSTIN is validated, and its embedded state code is compared with the
 *     state chosen below it. The shop's state decides CGST/SGST versus IGST on
 *     every bill, so a disagreement between the two is worth catching once here
 *     rather than on every invoice afterwards.
 *
 *   - The invoice format is validated against its reset policy. A format whose
 *     token cannot distinguish two periods will hand the same number to two
 *     customers — see `validateInvoiceFormat`. That one is a hard block: a
 *     duplicate invoice number is not something to warn about and allow.
 */

const RESET_POLICY_LABELS: Record<InvoiceResetPolicy, string> = {
  'financial-year': 'Every financial year (1 April)',
  'calendar-year': 'Every calendar year (1 January)',
  never: 'Never — one continuous series',
};

type Draft = Pick<
  BusinessDetails,
  | 'name'
  | 'gstin'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'pincode'
  | 'phone'
  | 'email'
  | 'bankName'
  | 'bankAccountNumber'
  | 'bankIfsc'
>;

/** A stored PLACEHOLDER reads as empty in the form — it is not real data. */
function displayValue(value: string): string {
  return value.startsWith('PLACEHOLDER') ? '' : value;
}

function toDraft(business: BusinessDetails): Draft {
  return {
    name: displayValue(business.name),
    gstin: displayValue(business.gstin),
    addressLine1: displayValue(business.addressLine1),
    addressLine2: displayValue(business.addressLine2),
    city: displayValue(business.city),
    state: displayValue(business.state),
    pincode: displayValue(business.pincode),
    phone: displayValue(business.phone),
    email: displayValue(business.email),
    bankName: displayValue(business.bankName),
    bankAccountNumber: displayValue(business.bankAccountNumber),
    bankIfsc: displayValue(business.bankIfsc),
  };
}

export default function SettingsScreen() {
  const business = useSettingsStore(selectBusiness);
  const invoiceConfig = useSettingsStore(selectInvoiceConfig);
  const saveBusiness = useSettingsStore((state) => state.saveBusiness);
  const saveInvoiceConfig = useSettingsStore((state) => state.saveInvoiceConfig);

  const [draft, setDraft] = useState<Draft>(() => toDraft(business));
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceNumberConfig>(invoiceConfig);
  const [saving, setSaving] = useState(false);
  const [pickingLogo, setPickingLogo] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed if the store is reloaded underneath (a Phase 6 restore, say).
  useEffect(() => setDraft(toDraft(business)), [business]);
  useEffect(() => setInvoiceDraft(invoiceConfig), [invoiceConfig]);

  const set = useCallback((field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }, []);

  const gstin = useMemo(() => parseGstin(draft.gstin), [draft.gstin]);

  /**
   * The same cross-check the Billing screen runs on a customer, pointed at the
   * shop. It matters more here: a customer's wrong state spoils one bill, the
   * shop's wrong state flips the tax heads on every bill at once.
   */
  const stateMismatch = useMemo(
    () =>
      businessStateGstinMismatch({
        ...business,
        gstin: draft.gstin || 'PLACEHOLDER_GSTIN',
        state: draft.state || 'PLACEHOLDER_STATE',
      }),
    [business, draft.gstin, draft.state]
  );

  const invoiceValidation = useMemo(
    () => validateInvoiceNumberConfig(invoiceDraft),
    [invoiceDraft]
  );
  const invoicePreview = useMemo(() => previewInvoiceNumber(invoiceDraft), [invoiceDraft]);

  const pickLogo = useCallback(async () => {
    setError(null);

    // Android 13+ grants read access to the picked item only, so no runtime
    // permission prompt is needed for the library picker. Older versions are
    // handled by the plugin's manifest entries.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 1,
    });

    if (picked.canceled || picked.assets.length === 0) return;

    setPickingLogo(true);
    try {
      // Copied out of the cache directory before the path is stored — see
      // lib/logo.ts for why a cache URI would quietly break later.
      const uri = await replaceLogo(picked.assets[0].uri, business.logoPath);
      await saveBusiness({ logoPath: uri });
    } catch (err) {
      setError(
        err instanceof Error ? `The logo could not be saved: ${err.message}` : 'The logo could not be saved.'
      );
    } finally {
      setPickingLogo(false);
    }
  }, [business.logoPath, saveBusiness]);

  const removeLogo = useCallback(() => {
    Alert.alert('Remove the logo?', 'Bills will be printed without it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const previous = business.logoPath;
          // Clear the stored path first: a file left behind is harmless, but a
          // path pointing at a deleted file breaks the bill template.
          await saveBusiness({ logoPath: '' });
          await deleteLogo(previous);
        },
      },
    ]);
  }, [business.logoPath, saveBusiness]);

  const handleSave = useCallback(async () => {
    // A bad invoice format can issue one number to two customers, so it blocks
    // the save outright rather than warning.
    if (!invoiceValidation.valid) {
      Alert.alert('Invoice format cannot be saved', invoiceValidation.errors.join('\n\n'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const patch: Partial<Record<BusinessSettingField, string | null>> = {
        name: draft.name.trim(),
        gstin: draft.gstin.replace(/[\s-]/g, '').toUpperCase(),
        addressLine1: draft.addressLine1.trim(),
        addressLine2: draft.addressLine2.trim(),
        city: draft.city.trim(),
        state: draft.state.trim(),
        pincode: draft.pincode.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        bankName: draft.bankName.trim(),
        bankAccountNumber: draft.bankAccountNumber.trim(),
        bankIfsc: draft.bankIfsc.trim().toUpperCase(),
      };

      await saveBusiness(patch);
      await saveInvoiceConfig(invoiceDraft);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, invoiceDraft, invoiceValidation, saveBusiness, saveInvoiceConfig]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          These details print on every bill. Fill them in before giving a bill to a customer.
        </Text>

        {/* --- Identity --- */}
        <Section title="Shop details">
          <Field
            label="Shop name"
            value={draft.name}
            onChangeText={(text) => set('name', text)}
            placeholder="As registered"
            autoCapitalize="words"
          />

          <Field
            label="GSTIN"
            value={draft.gstin}
            onChangeText={(text) => set('gstin', text.toUpperCase())}
            placeholder="15 characters"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={15}
            monospace
          />

          {draft.gstin.length > 0 && gstin.problem && gstin.problem !== 'empty' ? (
            <Note tone="warning" text={gstin.message ?? 'This GSTIN does not look right.'} />
          ) : null}
          {gstin.valid && gstin.state ? (
            <Note tone="ok" text={`Valid GSTIN — registered in ${gstin.state.name}.`} />
          ) : null}

          <StatePicker
            label="State"
            value={draft.state}
            onChange={(value) => set('state', value)}
            homeState={null}
          />

          {stateMismatch ? (
            <View>
              <Note
                tone="warning"
                text={`The GSTIN is registered in ${stateMismatch.gstinState}, but the state says ${stateMismatch.declaredState}. This decides CGST/SGST versus IGST on every bill.`}
              />
              <Pressable
                style={({ pressed }) => [styles.fixButton, pressed && styles.fixButtonPressed]}
                onPress={() => set('state', stateMismatch.gstinState)}
                accessibilityRole="button"
                accessibilityLabel={`Change the state to ${stateMismatch.gstinState}`}>
                <Ionicons name="arrow-forward-circle" size={18} color={Colors.brand} />
                <Text style={styles.fixButtonText}>
                  Change state to {stateMismatch.gstinState}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Field
            label="Address line 1"
            value={draft.addressLine1}
            onChangeText={(text) => set('addressLine1', text)}
            placeholder="Shop number, building"
            autoCapitalize="words"
          />
          <Field
            label="Address line 2"
            value={draft.addressLine2}
            onChangeText={(text) => set('addressLine2', text)}
            placeholder="Road, area"
            autoCapitalize="words"
          />
          <Field
            label="City"
            value={draft.city}
            onChangeText={(text) => set('city', text)}
            autoCapitalize="words"
          />
          <Field
            label="PIN code"
            value={draft.pincode}
            onChangeText={(text) => set('pincode', text.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Field
            label="Phone"
            value={draft.phone}
            onChangeText={(text) => set('phone', text)}
            keyboardType="phone-pad"
          />
          <Field
            label="Email"
            value={draft.email}
            onChangeText={(text) => set('email', text)}
            keyboardType="default"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Section>

        {/* --- Bank --- */}
        <Section title="Bank details" subtitle="Optional — printed at the foot of the bill.">
          <Field
            label="Bank name"
            value={draft.bankName}
            onChangeText={(text) => set('bankName', text)}
            autoCapitalize="words"
          />
          <Field
            label="Account number"
            value={draft.bankAccountNumber}
            onChangeText={(text) => set('bankAccountNumber', text)}
            keyboardType="number-pad"
            monospace
          />
          <Field
            label="IFSC"
            value={draft.bankIfsc}
            onChangeText={(text) => set('bankIfsc', text.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={11}
            monospace
          />
        </Section>

        {/* --- Invoice numbering --- */}
        <Section
          title="Invoice numbering"
          subtitle="An invoice number is a legal record. It must never repeat.">
          <Field
            label="Format"
            value={invoiceDraft.format}
            onChangeText={(text) => {
              setInvoiceDraft((current) => ({ ...current, format: text }));
              setSaved(false);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            monospace
          />

          <View style={styles.tokenList}>
            {INVOICE_FORMAT_TOKENS.map((token) => (
              <Text key={token.token} style={styles.tokenRow}>
                <Text style={styles.tokenName}>{token.token}</Text>
                {'  '}
                {token.meaning} — {token.example}
              </Text>
            ))}
          </View>

          <Text style={styles.label}>Restart the number</Text>
          <View style={styles.chipWrap}>
            {INVOICE_RESET_POLICIES.map((policy) => {
              const active = invoiceDraft.resetPolicy === policy;
              return (
                <Pressable
                  key={policy}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    setInvoiceDraft((current) => ({ ...current, resetPolicy: policy }));
                    setSaved(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={RESET_POLICY_LABELS[policy]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {RESET_POLICY_LABELS[policy]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Start the series at"
            value={String(invoiceDraft.startNumber)}
            onChangeText={(text) => {
              const parsed = Number.parseInt(text.replace(/\D/g, ''), 10);
              setInvoiceDraft((current) => ({
                ...current,
                startNumber: Number.isFinite(parsed) ? parsed : 1,
              }));
              setSaved(false);
            }}
            keyboardType="number-pad"
            maxLength={9}
          />
          <Note
            tone="info"
            text="If a paper bill book is part-used, set this above the last number already given to a customer — otherwise the app will reissue numbers they already hold."
          />

          {invoicePreview ? (
            <View style={styles.preview}>
              <Text style={styles.previewLabel}>The next bill would be</Text>
              <Text style={styles.previewValue}>{invoicePreview}</Text>
            </View>
          ) : null}

          {invoiceValidation.errors.map((message) => (
            <Note key={message} tone="error" text={message} />
          ))}
          {invoiceValidation.warnings.map((message) => (
            <Note key={message} tone="warning" text={message} />
          ))}
        </Section>

        {/* --- Logo --- */}
        <Section title="Shop logo" subtitle="Optional — printed at the top of the bill.">
          {business.logoPath ? (
            <View style={styles.logoRow}>
              <Image
                source={{ uri: business.logoPath }}
                style={styles.logoPreview}
                contentFit="contain"
                accessibilityLabel="The current shop logo"
              />
              <View style={styles.logoActions}>
                <Pressable
                  style={({ pressed }) => [styles.logoButton, pressed && styles.logoButtonPressed]}
                  onPress={pickLogo}
                  disabled={pickingLogo}
                  accessibilityRole="button"
                  accessibilityLabel="Choose a different logo">
                  <Text style={styles.logoButtonText}>Change</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.logoButton, pressed && styles.logoButtonPressed]}
                  onPress={removeLogo}
                  accessibilityRole="button"
                  accessibilityLabel="Remove the shop logo">
                  <Text style={[styles.logoButtonText, styles.logoRemoveText]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.logoPicker, pressed && styles.logoButtonPressed]}
              onPress={pickLogo}
              disabled={pickingLogo}
              accessibilityRole="button"
              accessibilityLabel="Choose a shop logo">
              {pickingLogo ? (
                <ActivityIndicator color={Colors.brand} />
              ) : (
                <Ionicons name="image-outline" size={28} color={Colors.brand} />
              )}
              <Text style={styles.logoPickerText}>
                {pickingLogo ? 'Saving…' : 'Choose an image'}
              </Text>
            </Pressable>
          )}

          {/* The logo is saved on selection rather than waiting for Save: it is
              a file copy, not a text field, and pairing it with the form's save
              button would mean a picked image could be silently lost by leaving
              the screen. */}
          <Note tone="info" text="The logo is saved as soon as you choose it." />
        </Section>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            pressed && styles.saveButtonPressed,
            saving && styles.saveButtonBusy,
          ]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save these details">
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Ionicons name={saved ? 'checkmark' : 'save'} size={20} color="#FFFFFF" />
          )}
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save details'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'words' | 'characters';
  autoCorrect?: boolean;
  maxLength?: number;
  monospace?: boolean;
};

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoCorrect = true,
  maxLength,
  monospace = false,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, monospace && styles.inputMono]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        maxLength={maxLength}
        accessibilityLabel={label}
      />
    </View>
  );
}

const NOTE_TONES = {
  ok: { icon: 'checkmark-circle', color: Colors.inStock },
  info: { icon: 'information-circle', color: Colors.textMuted },
  warning: { icon: 'warning', color: Colors.lowStock },
  error: { icon: 'alert-circle', color: Colors.outOfStock },
} as const;

function Note({ tone, text }: { tone: keyof typeof NOTE_TONES; text: string }) {
  const { icon, color } = NOTE_TONES[tone];
  return (
    <View style={styles.note}>
      <Ionicons name={icon} size={15} color={color} />
      <Text style={[styles.noteText, { color }]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, gap: Spacing.lg, paddingBottom: Spacing.xl },
  intro: { fontSize: FontSizes.small, color: Colors.textMuted },

  section: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  sectionTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  sectionSubtitle: { fontSize: FontSizes.small, color: Colors.textMuted, marginBottom: Spacing.xs },

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
  inputMono: { letterSpacing: 1.2, fontWeight: '600' },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, paddingTop: Spacing.xs },
  noteText: { flex: 1, fontSize: FontSizes.small },

  fixButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.brand,
    alignSelf: 'flex-start',
  },
  fixButtonPressed: { backgroundColor: Colors.background },
  fixButtonText: { fontSize: FontSizes.small, color: Colors.brand, fontWeight: '700' },

  tokenList: { gap: 2, paddingVertical: Spacing.xs },
  tokenRow: { fontSize: FontSizes.small - 1, color: Colors.textMuted },
  tokenName: { fontWeight: '700', color: Colors.text },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: Spacing.minTapTarget,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  chipText: { fontSize: FontSizes.small, color: Colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },

  preview: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 8,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 2,
  },
  previewLabel: { fontSize: FontSizes.small, color: Colors.textMuted },
  previewValue: {
    fontSize: FontSizes.title,
    fontWeight: '700',
    color: Colors.brand,
    letterSpacing: 1,
  },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  logoPreview: {
    width: 96,
    height: 96,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  logoActions: { flex: 1, gap: Spacing.sm },
  logoButton: {
    minHeight: Spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  logoButtonPressed: { backgroundColor: Colors.surface },
  logoButtonText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.brand },
  logoRemoveText: { color: Colors.outOfStock },
  logoPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget + 24,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.brand,
    backgroundColor: Colors.background,
  },
  logoPickerText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.brand },

  error: { fontSize: FontSizes.small, color: Colors.outOfStock },

  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: Spacing.minTapTarget + 4,
    borderRadius: 8,
    backgroundColor: Colors.brand,
  },
  saveButtonPressed: { backgroundColor: Colors.brandDark },
  saveButtonBusy: { opacity: 0.7 },
  saveButtonText: { color: '#FFFFFF', fontSize: FontSizes.body, fontWeight: '700' },
});
