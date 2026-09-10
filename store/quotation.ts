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
  addProduct: (product: Product) => void;
  setQty: (productId: number, qty: number) => void;
  changeQty: (productId: number, delta: number) => void;
  setUnit: (productId: number, unit: BillUnit | null) => void;
  removeLine: (productId: number) => void;
  setCustomerField: (field: QuotationCustomerField, value: string) => void;
  /** Replaces the whole quotation — used when re-opening one to copy. */
  load: (lines: QuotationLine[], customer: QuotationCustomer) => void;
  clear: () => void;
};

function normaliseQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1;
  return Math.max(1, Math.floor(qty));
}

export const useQuotationStore = create<QuotationState>((set) => ({
  lines: [],
  customer: EMPTY_QUOTATION_CUSTOMER,

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

  setUnit: (productId, unit) =>
    set((state) => ({
      lines: state.lines.map((line) => (line.productId === productId ? { ...line, unit } : line)),
    })),

  removeLine: (productId) =>
    set((state) => ({ lines: state.lines.filter((line) => line.productId !== productId) })),

  setCustomerField: (field, value) =>
    set((state) => ({ customer: { ...state.customer, [field]: value } })),

  load: (lines, customer) => set({ lines, customer }),

  clear: () => set({ lines: [], customer: EMPTY_QUOTATION_CUSTOMER }),
}));

export const selectQuotationLines = (state: QuotationState) => state.lines;
export const selectQuotationCustomer = (state: QuotationState) => state.customer;
export const selectQuotationItemCount = (state: QuotationState) =>
  state.lines.reduce((total, line) => total + line.qty, 0);
