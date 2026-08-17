import { Redirect } from 'expo-router';

/**
 * The Architecture doc lists `bill/new` as the new-bill route, but the flow
 * itself lives on the Billing tab (T3.3) so the tab bar stays available during a
 * sale — checking a price on the Inventory tab mid-bill is a normal thing to do
 * at a counter.
 *
 * This route is kept and redirected rather than deleted so that anything linking
 * to it still works — a deep link, or the documented route in the Architecture
 * doc.
 *
 * The Dashboard's "New Bill" button (T5.2) does NOT come through here: it moves
 * to the Billing tab directly. Going via this route would push a stack screen
 * with its own header, only to replace it a frame later — a visible flicker and
 * a stray entry in the back stack, for nothing.
 */
export default function NewBillScreen() {
  return <Redirect href="/billing" />;
}
