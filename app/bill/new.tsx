import { Redirect } from 'expo-router';

/**
 * The Architecture doc lists `bill/new` as the new-bill route, but the flow
 * itself lives on the Billing tab (T3.3) so the tab bar stays available during a
 * sale — checking a price on the Inventory tab mid-bill is a normal thing to do
 * at a counter.
 *
 * This route is kept and redirected rather than deleted so that anything linking
 * to it, including the Dashboard's "New Bill" button in T5.2, still works.
 */
export default function NewBillScreen() {
  return <Redirect href="/billing" />;
}
