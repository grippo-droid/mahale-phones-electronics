import type { LineDiscount } from '@/lib/gst';
import { create } from 'zustand';

import type { Product } from '@/db/products';
import type { BillUnit } from '@/lib/units';

/**
 * The quotation being prepared (T5.7).
 *
 * A separate store from `store/cart.ts` rather than a mode on it. The two are
 * built the same way but mean different things, and sharing one store would
 * mean a half-written quotation and a half-written bill could not exist at the
 * same time — which is exactly the situation the shop is in when a customer
 * asks "what would this come to?" in the middle of someone else's sale.
 *
 * Lines are snapshots for the same reason bill lines are: the customer is
 * quoted a name at a price, and editing the product afterwards must not
 * silently rewrite what was offered.
 *
 * Stock is not held here and not checked. A quotation moves nothing.
 */

export type QuotationLine = {
  productId: number;
  name: string;
  hsnCode: string | null;
  unitPrice: number;
  gstRate: number;
  priceIncludesGst: boolean;
  qty: number;
  unit: BillUnit | null;
  /** An optional discount on this line (T9.6), or null for none. */
  discount: LineDiscount | null;
};

export type QuotationCustomer = {
  name: string;
  phone: string;
  address: string;
};

export const EMPTY_QUOTATION_CUSTOMER: QuotationCustomer = { name: '', phone: '', address: '' };

export type QuotationCustomerField = keyof QuotationCustomer;

type QuotationState = {
  lines: QuotationLine[];
  customer: QuotationCustomer;
  /**
   * The quotation being edited, or null when this is a new one (T5.9).
   *
   * Mirrors `editingBillId` on the cart: the editor is the same screen that
   * makes a new quotation, and this is what makes it save over the existing
   * one — keeping its Q-number — instead of issuing another.
   */
  editingQuotationId: number | null;
  addProduct: (product: Product) => void;
  setQty: (productId: number, qty: number) => void;
  changeQty: (productId: number, delta: number) => void;
  setUnit: (productId: number, unit: BillUnit | null) => void;
  /** The discount on one line, or null to clear it (T9.6). */
  setDiscount: (productId: number, discount: LineDiscount | null) => void;
  removeLine: (productId: number) => void;
  setCustomerField: (field: QuotationCustomerField, value: string) => void;
  /** Replaces the whole quotation — used when re-opening one to copy. */
  load: (lines: QuotationLine[], customer: QuotationCustomer) => void;
  /**
   * Starts a new quotation: abandons an edit, keeps a genuine draft.
   *
   * The store outlives the editor screen on purpose, so backing out of an edit
   * leaves `editingQuotationId` set. Without this, "New Quotation" reopened
   * that abandoned edit — the title still read "Edit Quotation" and saving
   * overwrote the quotation the owner had walked away from. Its lines belong
   * to that quotation, not to a new one, so they go with it.
   *
   * A draft with no quotation behind it is left alone, matching the billing
   * cart, which is deliberately kept across navigation.
   */
  beginNew: () => void;
  /** Replaces it and marks the editor as editing that saved quotation. */
  loadForEdit: (
    lines: QuotationLine[],
    customer: QuotationCustomer,
    quotationId: number
  ) => void;
  clear: () => void;
};

function normaliseQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1;
  return Math.max(1, Math.floor(qty));
}

export const useQuotationStore = create<QuotationState>((set) => ({
  lines: [],
  customer: EMPTY_QUOTATION_CUSTOMER,
  editingQuotationId: null,

  addProduct: (product) =>
    set((state) => {
      const existing = state.lines.find((line) => line.productId === product.id);
      if (existing) {
        return {
          lines: state.lines.map((line) =>
            line.productId === product.id ? { ...line, qty: normaliseQty(line.qty + 1) } : line
          ),
        };
      }

      return {
        lines: [
          ...state.lines,
          {
            productId: product.id,
            name: product.name,
            hsnCode: product.hsn_code,
            unitPrice: product.unit_price,
            gstRate: product.gst_rate,
            priceIncludesGst: product.priceIncludesGst,
            qty: 1,
            unit: null,
            // No discount until one is asked for. An unasked-for default would
            // put money back in a customer's pocket by accident.
            discount: null,
          },
        ],
      };
    }),

  setQty: (productId, qty) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.productId === productId ? { ...line, qty: normaliseQty(qty) } : line
      ),
    })),

  changeQty: (productId, delta) =>
    set((state) => ({
      lines: state.lines.flatMap((line) => {
        if (line.productId !== productId) return [line];
        const next = line.qty + delta;
        return next < 1 ? [] : [{ ...line, qty: normaliseQty(next) }];
      }),
    })),

  /** Null clears it. A discount is per line, and only ever set deliberately. */
  setDiscount: (productId, discount) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.productId === productId ? { ...line, discount } : line
      ),
    })),

  setUnit: (productId, unit) =>
    set((state) => ({
      lines: state.lines.map((line) => (line.productId === productId ? { ...line, unit } : line)),
    })),

  removeLine: (productId) =>
    set((state) => ({ lines: state.lines.filter((line) => line.productId !== productId) })),

  setCustomerField: (field, value) =>
    set((state) => ({ customer: { ...state.customer, [field]: value } })),

  load: (lines, customer) => set({ lines, customer, editingQuotationId: null }),

  loadForEdit: (lines, customer, quotationId) =>
    set({ lines, customer, editingQuotationId: quotationId }),

  beginNew: () =>
    set((state) =>
      state.editingQuotationId === null
        ? state
        : { lines: [], customer: EMPTY_QUOTATION_CUSTOMER, editingQuotationId: null }
    ),

  clear: () =>
    set({ lines: [], customer: EMPTY_QUOTATION_CUSTOMER, editingQuotationId: null }),
}));

export const selectQuotationLines = (state: QuotationState) => state.lines;
export const selectQuotationCustomer = (state: QuotationState) => state.customer;
export const selectQuotationItemCount = (state: QuotationState) =>
  state.lines.reduce((total, line) => total + line.qty, 0);
