import { create } from 'zustand';

import { BUSINESS_DETAILS, type BusinessDetails } from '@/constants/business';
import { getDatabase } from '@/db/init';
import { getBusinessDetails, setBusinessDetails, type BusinessSettingField } from '@/db/settings';
import {
  DEFAULT_INVOICE_NUMBER_CONFIG,
  getInvoiceNumberConfig,
  setInvoiceNumberConfig,
  type InvoiceNumberConfig,
} from '@/lib/invoiceNumber';

/**
 * The shop's own details, as they currently stand (T4.1).
 *
 * Until now `constants/business.ts` WAS the business details. From here it is
 * only the first-run defaults: the live values live in `app_settings`, so they
 * are editable on the phone and travel with a Phase 6 backup.
 *
 * The store exists because those values are read all over the app — the tax
 * split on the Billing screen and the invoice header in T4.2 — and re-querying
 * SQLite on every render would be both slow and a source
 * of screens disagreeing with each other mid-edit.
 *
 * `hydrated` matters more than it looks. Before the first load completes the
 * store is holding the placeholder defaults, and a screen that cannot tell the
 * difference would render a bill header full of PLACEHOLDER text for a frame.
 * Anything that prints or bills should wait for it.
 */

type SettingsState = {
  business: BusinessDetails;
  invoice: InvoiceNumberConfig;
  /** False until the first load from the database has finished. */
  hydrated: boolean;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  saveBusiness: (patch: Partial<Record<BusinessSettingField, string | null>>) => Promise<void>;
  saveInvoiceConfig: (config: InvoiceNumberConfig) => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  business: BUSINESS_DETAILS,
  invoice: DEFAULT_INVOICE_NUMBER_CONFIG,
  hydrated: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      // `lib/invoiceNumber.ts` takes its database explicitly rather than
      // defaulting, because it is usually handed a transaction handle instead.
      const [business, invoice] = await Promise.all([
        getBusinessDetails(),
        getInvoiceNumberConfig(getDatabase()),
      ]);
      set({ business, invoice, hydrated: true, loading: false });
    } catch (err) {
      // Leave `hydrated` false: the defaults are still in place, and a caller
      // that checks it will know not to trust them for anything printed.
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  saveBusiness: async (patch) => {
    await setBusinessDetails(patch);
    // Re-read rather than merging the patch in: the repository decides how a
    // cleared field falls back, and duplicating that rule here is how the two
    // drift apart.
    const business = await getBusinessDetails();
    set({ business, error: null });
  },

  saveInvoiceConfig: async (config) => {
    // Throws on an invalid format — a format whose token does not match its
    // reset period can issue the same number twice. See lib/invoiceNumber.ts.
    await setInvoiceNumberConfig(config, getDatabase());
    const invoice = await getInvoiceNumberConfig(getDatabase());
    set({ invoice, error: null });
  },
}));

// ---------------------------------------------------------------------------
// Selectors — primitives or existing references only, per the note in cart.ts.
// ---------------------------------------------------------------------------

export const selectBusiness = (state: SettingsState) => state.business;

/** The state the customer's is compared against to pick CGST/SGST or IGST. */
export const selectBusinessState = (state: SettingsState) => state.business.state;

export const selectInvoiceConfig = (state: SettingsState) => state.invoice;

export const selectHydrated = (state: SettingsState) => state.hydrated;
