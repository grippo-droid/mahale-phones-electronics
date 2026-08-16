import { create } from 'zustand';

import type { Product } from '@/db/products';

/**
 * The bill in progress (T3.3).
 *
 * Held in Zustand rather than in the Billing screen's own state because the cart
 * has to survive navigation. Checking a price on the Inventory tab part-way
 * through a sale is a normal thing to do at a counter, and losing a half-built
 * bill because of it is the kind of thing that stops someone trusting the app.
 *
 * ---------------------------------------------------------------------------
 * A line is a SNAPSHOT, not a live view of the product.
 *
 * Price, name, GST rate and HSN are copied in when the item is added, and are
 * what `bill_items` stores when the bill is written (T3.6). Editing a product
 * mid-bill therefore does not silently reprice a line the customer has already
 * been quoted.
 *
 * Stock is the deliberate exception and is NOT held here — it moves underneath
 * the cart as other bills and manual adjustments land, so the screen reads it
 * live from the database instead of trusting a copy.
 * ---------------------------------------------------------------------------
 *
 * T3.4 extends this store with the customer details.
 */

export type CartLine = {
  productId: number;
  /** Snapshot — see the note above. */
  name: string;
  hsnCode: string | null;
  unitPrice: number;
  gstRate: number;
  priceIncludesGst: boolean;
  qty: number;
};

type CartState = {
  lines: CartLine[];
  /** Adds the product, or bumps the quantity if it is already on the bill. */
  addProduct: (product: Product) => void;
  setQty: (productId: number, qty: number) => void;
  changeQty: (productId: number, delta: number) => void;
  removeLine: (productId: number) => void;
  clear: () => void;
};

/**
 * Quantities are whole numbers of at least one: `db/bills.ts` rejects anything
 * else, and a line of zero is a removal, not a quantity. Clamping here means no
 * caller can put an unbillable line into the cart in the first place.
 */
function normaliseQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1;
  return Math.max(1, Math.floor(qty));
}

export const useCartStore = create<CartState>((set) => ({
  lines: [],

  addProduct: (product) =>
    set((state) => {
      const existing = state.lines.find((line) => line.productId === product.id);

      // Tapping the same product again adds one more rather than starting a
      // duplicate line — two lines for one product would split the quantity
      // across the invoice for no reason.
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
        // Stepping below one removes the line, so the minus button empties a
        // line without needing a separate delete for the common case.
        const next = line.qty + delta;
        return next < 1 ? [] : [{ ...line, qty: normaliseQty(next) }];
      }),
    })),

  removeLine: (productId) =>
    set((state) => ({ lines: state.lines.filter((line) => line.productId !== productId) })),

  clear: () => set({ lines: [] }),
}));

// ---------------------------------------------------------------------------
// Selectors
//
// Each returns a primitive or an existing reference. Returning a freshly built
// object or array from a selector would give a new identity on every render and
// re-render forever.
// ---------------------------------------------------------------------------

export const selectLines = (state: CartState) => state.lines;

/** Total units on the bill — 3 of one item and 2 of another is 5, not 2. */
export const selectItemCount = (state: CartState) =>
  state.lines.reduce((total, line) => total + line.qty, 0);

export const selectLineCount = (state: CartState) => state.lines.length;

export const selectIsEmpty = (state: CartState) => state.lines.length === 0;
