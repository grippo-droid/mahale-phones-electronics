import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import {
  BackupFormatError,
  createBackup,
  findSafetyCopy,
  previewRestore,
  restoreBackup,
  RestoreFailedError,
} from '@/db/backup';
import { resetShopData } from '@/db/reset';
import { showToast } from '@/store/toast';
import { getLastBackupAt, type BusinessSettingField } from '@/db/settings';
import { describeBackupStatus } from '@/lib/backupStatus';
import { formatDate } from '@/lib/format';
import { useCartStore } from '@/store/cart';
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

/**
 * Keeps messages that were written to be read by the shop owner, and replaces
 * anything internal with a plain sentence.
 *
 * `getDatabase()` throws "Database not initialised yet — await initDatabase()
 * first". That is a note to a developer, and putting it on the screen of a
 * first-time user standing at a counter tells them nothing they can act on —
 * it just looks like the app has broken. `BackupFormatError` and
 * `RestoreFailedError` are the two that are written for him, and they pass
 * through unchanged.
 *
 * The original is logged rather than dropped, so it is still there in Metro
 * while the app is being built.
 */
function ownerMessage(error: unknown, fallback: string): string {
  // Always logged, including the errors that are shown verbatim. A
  // RestoreFailedError carries the real failure as its `cause`, and that is
  // the only place the underlying reason exists — without this it is lost, and
  // working out why a restore failed means another round trip to the phone.
  console.warn('[settings] error:', error, 'cause:', (error as { cause?: unknown })?.cause);

  if (error instanceof BackupFormatError || error instanceof RestoreFailedError) {
    return error.message;
  }
  return fallback;
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

  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  // The reset is deliberately behind a typed word rather than a tap. It is the
  // only action here that destroys data with nothing kept back — a restore at
  // least writes the safety copy first — and it is reached from the same screen
  // as the backup button.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // The undo is offered only when there is something to undo, so this is the
  // presence of the safety copy rather than a flag we set ourselves — a flag
  // would be a second record of the same fact, free to disagree with the file.
  const [undoUri, setUndoUri] = useState<string | null>(null);

  // Re-seed if the store is reloaded underneath (a Phase 6 restore, say).
  useEffect(() => setDraft(toDraft(business)), [business]);
  useEffect(() => setInvoiceDraft(invoiceConfig), [invoiceConfig]);

  const set = useCallback((field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }, []);

  const refreshUndo = useCallback(() => {
    try {
      setUndoUri(findSafetyCopy()?.uri ?? null);
    } catch {
      // Not being able to look is the same as there being nothing to offer.
      setUndoUri(null);
    }
  }, []);

  // Re-read on focus rather than once: a backup can be made from here and the
  // row is also carried in by a restore.
  useFocusEffect(
    useCallback(() => {
      getLastBackupAt().then(setLastBackup).catch(() => setLastBackup(null));
      refreshUndo();
    }, [refreshUndo])
  );

  const backupStatus = useMemo(() => describeBackupStatus(lastBackup), [lastBackup]);

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

  /**
   * Make a backup, then offer it to the share sheet (T6.2).
   *
   * The two steps are reported separately on purpose. Creating the file is the
   * part that can fail for a reason worth showing; the share sheet closing tells
   * us nothing — Android reports dismissal, not whether Drive accepted the file
   * — so a cancelled share must not read as a failed backup. The file is on the
   * phone either way, and `listBackups` keeps it for a retry.
   */
  const backUpNow = useCallback(async () => {
    setBackupError(null);
    setBackingUp(true);

    let made: Awaited<ReturnType<typeof createBackup>>;
    try {
      made = await createBackup();
    } catch (err) {
      setBackupError(ownerMessage(err, 'The backup could not be made. Please try again.'));
      setBackingUp(false);
      return;
    }

    setLastBackup(made.manifest.createdAt);
    setBackingUp(false);

    // Deliberately says the file was made and stops there. The share sheet
    // never reports whether the transfer succeeded, so anything warmer would
    // claim more than the app can know — the same reason the status line says
    // "Last backup" and never "your data is safe".
    showToast(`Backup made — ${made.fileName}`);

    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(made.uri, {
          mimeType: 'application/octet-stream',
          dialogTitle: 'Send your backup somewhere safe',
        });
      } else {
        setBackupError(
          `The backup was saved on this phone as ${made.fileName}, but this phone has no way to share it.`
        );
      }
    } catch (err) {
      // The backup itself succeeded — say so, and say what went wrong after.
      setBackupError(
        ownerMessage(
          err,
          'The backup was made, but it could not be shared. Tap Back up now to try sending it again.'
        )
      );
    }
  }, []);

  const openReset = useCallback(() => {
    setResetText('');
    setResetError(null);
    setResetOpen(true);
  }, []);

  /**
   * Clears the shop's own data, keeping its details and the schema.
   *
   * The cart is emptied afterwards because it holds product ids that now point
   * at nothing — a half-built bill surviving a reset would fail at "Generate
   * Bill" with a deleted-product warning for every line, which reads as the app
   * being broken rather than as the reset having worked.
   *
   * The business details are NOT reloaded, because the reset does not touch
   * them. That is the point of keeping them: a GSTIN retyped by hand is its own
   * source of error.
   */
  const confirmReset = useCallback(async () => {
    setResetError(null);
    setResetting(true);
    try {
      const summary = await resetShopData();
      useCartStore.getState().clear();

      // Closes rather than showing a "Done" step. The confirmation carries no
      // decision, so a second modal screen to dismiss is pure friction — but
      // the figures are worth keeping, so they go in the banner.
      setResetOpen(false);
      showToast(
        `Cleared ${summary.products} ${summary.products === 1 ? 'product' : 'products'}` +
          ` and ${summary.bills} ${summary.bills === 1 ? 'bill' : 'bills'}` +
          (summary.invoiceCounters > 0 || summary.quotationCounterCleared
            ? '. Numbering starts from the beginning again.'
            : '.')
      );
    } catch (err) {
      setResetError(
        ownerMessage(err, 'The data could not be cleared, so nothing was changed. Please try again.')
      );
    } finally {
      setResetting(false);
    }
  }, []);

  /**
   * The confirmation and the restore itself, shared by both ways in (T6.3).
   *
   * The middle step is the point: pick the file, show what is actually in it
   * beside what is on the phone, and only then replace anything. A
   * confirmation reading "replace all your data?" is one nobody can answer
   * safely — "replace 214 bills with the 198 in this backup from 12 August?"
   * is one the owner can judge.
   *
   * `mode` changes the wording and nothing else. The undo is the same
   * operation on a different file, and giving it its own copy of this would be
   * two restore paths to keep in step — the more dangerous one being the one
   * reached least often, and so tested least.
   */
  const confirmAndRestore = useCallback(
    async (uri: string, mode: 'file' | 'undo') => {
      setBackupError(null);

      let preview: Awaited<ReturnType<typeof previewRestore>>;
      try {
        preview = await previewRestore(uri);
      } catch (err) {
        // Everything decodeBackup rejects arrives here already worded for the
        // owner — wrong file, truncated, damaged, made by a newer app.
        setBackupError(
          ownerMessage(
            err,
            mode === 'undo'
              ? 'The copy saved before the last restore could not be read.'
              : 'That file could not be read as a backup.'
          )
        );
        // It may have been removed underneath us; stop offering it if so.
        if (mode === 'undo') refreshUndo();
        return;
      }

      const { manifest, current } = preview;
      const taken = new Date(manifest.createdAt);
      const from = manifest.shopName ? `${manifest.shopName}, ` : '';

      const held =
        `${manifest.counts.products} products and ${manifest.counts.bills} bills`;
      const onPhone =
        `This phone currently has ${current.products} products and ${current.bills} bills.`;

      // Both paths save a copy before they overwrite anything, so neither is
      // the one-way door the first version of this warned it was.
      const reversible =
        'A copy of what is on this phone right now is saved first, so this can be put back.';

      const title =
        mode === 'undo'
          ? 'Put back the data from before the last restore?'
          : 'Replace everything with this backup?';

      const body =
        mode === 'undo'
          ? `This is how the phone was on ${formatDate(taken)}, just before the last ` +
            `restore: ${held}.\n\n${onPhone} All of it will be replaced, including ` +
            `anything entered since that restore.\n\n${reversible}`
          : `This backup was made on ${formatDate(taken)} and holds ${from}${held}.\n\n` +
            `${onPhone} All of it will be replaced, ` +
            `including bills raised since the backup was made.\n\n${reversible}`;

      Alert.alert(title, body, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: mode === 'undo' ? 'Put it back' : 'Replace everything',
          style: 'destructive',
          onPress: async () => {
            setRestoring(true);
            try {
              await restoreBackup(uri);

              // The database underneath the app is a different one now. The
              // settings store is holding the old shop's details, and the cart
              // is holding product ids that may belong to nothing.
              await useSettingsStore.getState().load();
              useCartStore.getState().clear();
              setLastBackup(await getLastBackupAt());

              showToast(
                `${mode === 'undo' ? 'Put back' : 'Restored'} — ${held} are back.`
              );
            } catch (err) {
              setBackupError(ownerMessage(err, 'The backup could not be restored.'));
            } finally {
              // The restore has written a fresh safety copy, whatever the
              // outcome — and if it failed before that point there may now be
              // none. Either way the button's state is read from the file.
              refreshUndo();
              setRestoring(false);
            }
          },
        },
      ]);
    },
    [refreshUndo]
  );

  /** Restore from a file the owner picks — from Drive, WhatsApp, wherever. */
  const restoreFromBackup = useCallback(async () => {
    setBackupError(null);

    const picked = await File.pickFileAsync({ mimeTypes: ['*/*'] });
    if (picked.canceled || !picked.result) return;

    await confirmAndRestore(picked.result.uri, 'file');
  }, [confirmAndRestore]);

  /**
   * Undo the last restore.
   *
   * Every restore copies the current data to `restore-safety/` before it
   * overwrites anything. Until this button existed that file could not be
   * reached: it is deliberately outside `backups/` so pruning cannot take it,
   * which also keeps it out of `listBackups`, and the picker above only sees
   * places the system will show — not the app's own scoped directory.
   */
  const undoLastRestore = useCallback(async () => {
    if (!undoUri) return;
    await confirmAndRestore(undoUri, 'undo');
  }, [confirmAndRestore, undoUri]);

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
      setError(ownerMessage(err, 'The logo could not be saved. Please try again.'));
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
      setError(ownerMessage(err, 'Your details could not be saved. Please try again.'));
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

        {/* --- Backup --- */}
        <Section
          title="Backup"
          subtitle="Everything — products, bills, invoice numbers and these settings.">
          <View style={styles.backupStatusRow}>
            <Ionicons
              name={backupStatus.overdue ? 'alert-circle' : 'checkmark-circle'}
              size={20}
              color={backupStatus.overdue ? Colors.lowStock : Colors.inStock}
            />
            <Text
              style={[styles.backupStatus, backupStatus.overdue && styles.backupStatusOverdue]}>
              {backupStatus.label}
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.backupButton,
              pressed && styles.backupButtonPressed,
              backingUp && styles.saveButtonBusy,
            ]}
            onPress={backUpNow}
            disabled={backingUp}
            accessibilityRole="button"
            accessibilityLabel="Make a backup and send it somewhere safe">
            {backingUp ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
            )}
            <Text style={styles.backupButtonText}>
              {backingUp ? 'Making the backup…' : 'Back up now'}
            </Text>
          </Pressable>

          {/* The one thing the owner has to understand about this feature. A
              backup sitting on the phone is lost with the phone, so the share
              step is the point of it, not an optional extra. */}
          <Note
            tone="info"
            text="Send the file to Google Drive, or to yourself on WhatsApp. A backup kept only on this phone is lost with the phone."
          />

          <Pressable
            style={({ pressed }) => [styles.restoreButton, pressed && styles.logoButtonPressed]}
            onPress={restoreFromBackup}
            disabled={restoring || backingUp}
            accessibilityRole="button"
            accessibilityLabel="Replace everything on this phone with a backup file">
            {restoring ? (
              <ActivityIndicator color={Colors.brand} />
            ) : (
              <Ionicons name="cloud-download-outline" size={20} color={Colors.brand} />
            )}
            <Text style={styles.restoreButtonText}>
              {restoring ? 'Restoring…' : 'Restore from a backup'}
            </Text>
          </Pressable>

          {/* Said before it is tapped, not only in the confirmation. Someone
              reaching for Restore usually wants their data back, and does not
              always realise that what is on the phone now goes in its place. */}
          <Note
            tone="warning"
            text="Restoring replaces everything on this phone — including any bills raised since that backup was made."
          />

          {/* Shown only when a restore has actually run, so a phone that has
              never restored is not offered a way to undo nothing. */}
          {undoUri ? (
            <>
              <Pressable
                style={({ pressed }) => [
                  styles.restoreButton,
                  pressed && styles.logoButtonPressed,
                ]}
                onPress={undoLastRestore}
                disabled={restoring || backingUp}
                accessibilityRole="button"
                accessibilityLabel="Put back the data from before the last restore">
                <Ionicons name="arrow-undo-outline" size={20} color={Colors.brand} />
                <Text style={styles.restoreButtonText}>Undo last restore</Text>
              </Pressable>

              <Note
                tone="info"
                text="Every restore saves a copy of what was on the phone first. This puts that copy back."
              />
            </>
          ) : null}

          {backupError ? <Note tone="warning" text={backupError} /> : null}
        </Section>

        <Section
          title="Start fresh"
          subtitle="Clears everything the shop has entered, and keeps the shop's own details.">
          <Pressable
            style={({ pressed }) => [styles.resetButton, pressed && styles.logoButtonPressed]}
            onPress={openReset}
            disabled={restoring || backingUp}
            accessibilityRole="button"
            accessibilityLabel="Clear all products and bills from this phone">
            <Ionicons name="trash-outline" size={20} color={Colors.outOfStock} />
            <Text style={styles.resetButtonText}>Reset shop data</Text>
          </Pressable>

          {/* Says what it is for, because otherwise the only reason to tap it
              is curiosity, and that is not a good reason to tap this one. */}
          <Note
            tone="info"
            text="For after testing: clears every product and bill so the first real invoice starts at the beginning of your numbering. Your shop details, GSTIN and invoice format are kept."
          />
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

      {/* A Modal rather than Alert.prompt, which is iOS-only — on Android it
          simply does nothing, which would have shipped as a reset button that
          silently never asks. */}
      <Modal
        visible={resetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => (resetting ? undefined : setResetOpen(false))}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <>
                <Text style={styles.modalTitle}>Reset shop data?</Text>
                <Text style={styles.modalBody}>
                  This removes every product and every bill on this phone, and cannot be undone.
                  Your shop details, GSTIN and invoice format are kept.
                </Text>

                {/* Offered here, not just recommended in a note. The moment
                    someone is about to do this is the moment a backup is worth
                    most, and sending them to another section to find it is how
                    it does not happen. */}
                <Pressable
                  style={({ pressed }) => [styles.modalSecondary, pressed && styles.logoButtonPressed]}
                  onPress={backUpNow}
                  disabled={backingUp || resetting}
                  accessibilityRole="button"
                  accessibilityLabel="Make a backup before clearing">
                  {backingUp ? (
                    <ActivityIndicator color={Colors.brand} />
                  ) : (
                    <Ionicons name="cloud-upload-outline" size={18} color={Colors.brand} />
                  )}
                  <Text style={styles.modalSecondaryText}>
                    {backingUp ? 'Making the backup…' : 'Back up first'}
                  </Text>
                </Pressable>

                <Text style={styles.modalLabel}>Type RESET to confirm</Text>
                <TextInput
                  style={styles.modalInput}
                  value={resetText}
                  onChangeText={setResetText}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!resetting}
                  placeholder="RESET"
                  placeholderTextColor={Colors.textMuted}
                  accessibilityLabel="Type RESET to confirm clearing the data"
                />

                {resetError ? <Note tone="warning" text={resetError} /> : null}

                <View style={styles.modalActions}>
                  <Pressable
                    style={({ pressed }) => [styles.modalCancel, pressed && styles.logoButtonPressed]}
                    onPress={() => setResetOpen(false)}
                    disabled={resetting}
                    accessibilityRole="button">
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [
                      styles.modalDanger,
                      // Trimmed, but not case-folded: typing the word in capitals
                      // is the deliberate act being asked for.
                      resetText.trim() !== 'RESET' && styles.modalDangerDisabled,
                      pressed && styles.saveButtonPressed,
                    ]}
                    onPress={confirmReset}
                    disabled={resetText.trim() !== 'RESET' || resetting}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all products and bills now">
                    {resetting ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.modalDangerText}>Clear everything</Text>
                    )}
                  </Pressable>
                </View>
            </>
          </View>
        </View>
      </Modal>
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
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.outOfStock,
    paddingHorizontal: Spacing.md,
  },
  resetButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: Colors.outOfStock },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.background,
    borderRadius: 14,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  modalTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  modalBody: { fontSize: FontSizes.body, color: Colors.text, lineHeight: 21 },
  modalLabel: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.textMuted },
  modalInput: {
    minHeight: Spacing.minTapTarget,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: Spacing.md,
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.text,
  },
  modalActions: { flexDirection: 'row', gap: Spacing.sm },
  modalCancel: {
    flex: 1,
    minHeight: Spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalCancelText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.text },
  modalDanger: {
    flex: 1,
    minHeight: Spacing.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: Colors.outOfStock,
  },
  modalDangerDisabled: { opacity: 0.4 },
  modalDangerText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },
  modalSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.brand,
  },
  modalSecondaryText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.brand },
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
  backupStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  backupStatus: { fontSize: FontSizes.body, color: Colors.text, fontWeight: '600' },
  backupStatusOverdue: { color: Colors.lowStock },
  backupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
    backgroundColor: Colors.brand,
  },
  backupButtonPressed: { backgroundColor: Colors.brandDark },
  backupButtonText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.brand,
  },
  restoreButtonText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.brand },
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
