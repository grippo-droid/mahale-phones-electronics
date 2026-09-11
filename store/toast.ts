import { create } from 'zustand';

/**
 * Brief confirmations for actions that otherwise finish silently (T7.3).
 *
 * A store rather than per-screen state, because several of these actions
 * report on a DIFFERENT screen from the one they were started on: adding a
 * product navigates back to Inventory, generating a bill goes to the bill,
 * saving a quotation goes to the quotation. Local state would be unmounted
 * before it could say anything.
 *
 * It replaces dialogs rather than adding to them. The app already avoids
 * unnecessary modals — an oversell warning is inline, a paid tag toggles with
 * one tap — and a confirmation that something SUCCEEDED is the least deserving
 * of a dialog: it carries no decision, and dismissing it is pure friction. The
 * restore success Alert and the reset's "Done" modal step are both gone,
 * replaced by this.
 *
 * What it must never become: a way to report failures that need a decision, or
 * anything the owner has to read to stay correct. It disappears on its own, so
 * anything important enough to miss does not belong here. Errors that need
 * acting on stay where they are — inline on the screen that owns them.
 */

export type ToastTone = 'success' | 'error';

export type Toast = {
  /** Changes on every show, so the same message twice restarts the timer. */
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastState = {
  toast: Toast | null;
  show: (message: string, tone?: ToastTone) => void;
  dismiss: (id?: number) => void;
};

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toast: null,

  show: (message, tone = 'success') => {
    nextId += 1;
    set({ toast: { id: nextId, message, tone } });
  },

  /**
   * Pass the id to dismiss only that toast. A timer firing for a toast that has
   * already been replaced must not clear the newer one off the screen.
   */
  dismiss: (id) =>
    set((state) => {
      if (id !== undefined && state.toast?.id !== id) return state;
      return { toast: null };
    }),
}));

/** Callable from anywhere, including outside React — most call sites are. */
export function showToast(message: string, tone: ToastTone = 'success'): void {
  useToastStore.getState().show(message, tone);
}
