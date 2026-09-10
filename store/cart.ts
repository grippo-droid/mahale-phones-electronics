import { create } from 'zustand';

import type { Product } from '@/db/products';
import { EMPTY_CUSTOMER, type Customer, type CustomerField } from '@/lib/customer';
import { defaultPaidFor, type PaymentType } from '@/lib/payment';
import type { BillUnit } from '@/lib/units';

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
 * The customer (T3.4) lives here too, and for the same reason as the lines: it
 * has to survive a trip to another tab. It is held as raw text exactly as typed,
 * with validation left to `lib/customer.ts` — a store that rejected input would
 * make a half-typed phone number impossible to hold.
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
  /**
   * How the quantity is measured, or null when none has been chosen. Null is
   * the starting state on purpose: the unit is a statement about the sale, and
   * an unasked-for default would put one on the invoice by accident.
   */
  unit: BillUnit | null;
};

type CartState = {
  lines: CartLine[];
  customer: Customer;
  /**
   * How this sale is being settled. Null until chosen — the bill cannot be
   * generated without it, and a default here would mean most bills silently
   * recording whichever one was picked as the default.
   */
  paymentType: PaymentType | null;
  /**
   * Whether the money has arrived. Follows the payment type when one is picked,
   * and can be changed afterwards without changing the type.
   */
  paid: boolean;
  /** Adds the product, or bumps the quantity if it is already on the bill. */
  addProduct: (product: Product) => void;
  setQty: (productId: number, qty: number) => void;
  /** Also resets `paid` to the usual status for that type. */
  setPaymentType: (paymentType: PaymentType) => void;
  setPaid: (paid: boolean) => void;
  /** Pass null to clear it — tapping the chosen unit again unsets it. */
  setUnit: (productId: number, unit: BillUnit | null) => void;
  changeQty: (productId: number, delta: number) => void;
  removeLine: (productId: number) => void;
  setCustomerField: (field: CustomerField, value: string) => void;
  setCustomer: (customer: Customer) => void;
  resetCustomer: () => void;
  /** Empties the whole bill — lines and customer both. */
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
  customer: EMPTY_CUSTOMER,
  paymentType: null,
  // Meaningless until a payment type is chosen, and never read before then.
  paid: false,

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

  // Changing the type re-applies that type's usual status, overwriting one set
  // by hand. That is deliberate: changing the type is itself a statement about
  // how the sale is being settled, and the overwrite is nearly always harmless
  // because the two defaults are the two states, so an override survives
  // whenever it agrees with the new type's default.
  //
  // Re-tapping the type already chosen is NOT a change and does nothing. The
  // selected chip looks like it might be a confirm button, and without this
  // guard an idle tap on it would quietly undo a status the owner had just set
  // by hand — the one case where the overwrite destroys a real decision.
  setPaymentType: (paymentType) =>
    set((state) =>
      state.paymentType === paymentType
        ? state
        : { paymentType, paid: defaultPaidFor(paymentType) }
    ),

  setPaid: (paid) => set({ paid }),

  setUnit: (productId, unit) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.productId === productId ? { ...line, unit } : line
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

  setCustomerField: (field, value) =>
    set((state) => ({ customer: { ...state.customer, [field]: value } })),

  setCustomer: (customer) => set({ customer }),

  resetCustomer: () => set({ customer: EMPTY_CUSTOMER }),

  // Clearing the bill clears the customer as well. The next sale is to a
  // different person, and a name left over from the last one is exactly the
  // sort of thing that reaches an invoice unnoticed.
  clear: () => set({ lines: [], customer: EMPTY_CUSTOMER, paymentType: null, paid: false }),
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

export const selectCustomer = (state: CartState) => state.customer;

/** The customer's state on its own, so a component that only needs the tax
 *  split does not re-render on every keystroke in the name field. */
export const selectCustomerState = (state: CartState) => state.customer.state;
