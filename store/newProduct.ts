import { create } from 'zustand';

import type { Product } from '@/db/products';

/**
 * A product just created from inside a bill or a quotation, waiting to be
 * added to the one that asked for it (T9.4).
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all, since a store slot is normally the wrong answer.
 *
 * The flow is: searching on Billing finds nothing, the owner taps "add it to
 * Inventory", fills the real Add Product form, saves, and lands back on the
 * bill — where they are asked how many. That last step has to happen on the
 * BILL, not on the Add Product screen, so the created product has to travel
 * back. `router.back()` carries nothing, so something has to hold it.
 *
 * The danger with a slot like this is one left behind: a product handed over,
 * never collected, and added to some unrelated bill days later. So there is no
 * plain read. `take()` returns it and clears it in the same call, and only
 * when the target matches, so it cannot be collected twice and cannot be
 * collected by the wrong screen.
 * ---------------------------------------------------------------------------
 */

export type NewProductTarget = 'bill' | 'quotation';

type Handover = {
  product: Product;
  /** Who asked. A quotation must not pick up what Billing was owed. */
  target: NewProductTarget;
};

type NewProductState = {
  pending: Handover | null;
  hand: (product: Product, target: NewProductTarget) => void;
  /** Returns the product for this target and clears it. Null if there is none. */
  take: (target: NewProductTarget) => Product | null;
  /** Dropped without being used — leaving the flow, rather than completing it. */
  discard: () => void;
};

export const useNewProductStore = create<NewProductState>((set, get) => ({
  pending: null,

  hand: (product, target) => set({ pending: { product, target } }),

  take: (target) => {
    const { pending } = get();
    if (!pending || pending.target !== target) return null;
    set({ pending: null });
    return pending.product;
  },

  discard: () => set({ pending: null }),
}));
