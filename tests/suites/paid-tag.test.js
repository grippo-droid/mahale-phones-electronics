'use strict';

/**
 * The tappable payment status tag (T5.10, reworked for the ledger in T9.2).
 *
 * Source-level: there is no renderer, so touch handling — the nested Pressable
 * inside a row that navigates — has to be checked on a real build.
 */

const { readSource } = require('../harness/check');

async function run({ check, section }) {
  const history = readSource('app/(tabs)/history.tsx');
  const dashboard = readSource('app/(tabs)/dashboard.tsx');
  const billScreen = readSource('app/bill/[id].tsx');
  const tags = readSource('components/PaymentTags.tsx');
  const hook = readSource('components/useBillPayments.ts');

  section('the shortcut is reachable from both lists');
  check('History passes a handler to the tag',
    history.includes('onTogglePaid={() => onTogglePaid(bill)}'), true);
  check('History settles through the shared hook', /tapTag\(bill, setError\)/.test(history), true);
  check('Dashboard passes a handler to the tag',
    dashboard.includes('onTogglePaid={() => onTogglePaid(bill)}'), true);
  check('Dashboard settles through the shared hook',
    /tapTag\(bill, setPaidError\)/.test(dashboard), true);
  // One implementation, not two. Both screens draw the same tag and offer the
  // same shortcut; two copies would drift the way the category chips did.
  check('neither screen writes its own settle logic',
    /settleRemaining/.test(history) || /settleRemaining/.test(dashboard), false);

  section('the bill screen stays read-only');
  // It carries the full ledger, so a one-tap shortcut beside it would be two
  // ways to do the same thing with different amounts.
  check('the bill screen renders the tags', billScreen.includes('<PaymentTags'), true);
  check('and passes no toggle', /PaymentTags[^/]*onTogglePaid/s.test(billScreen), false);
  check('but it does carry the ledger', billScreen.includes('<PaymentLedger'), true);

  section('a failed write puts the ledger back');
  // Money is exactly the wrong thing to be optimistic about and quiet.
  check('the previous ledger is restored',
    hook.includes('setLedgers((all) => new Map(all).set(bill.id, current))'), true);
  check('and it says which bill did not change',
    hook.includes('could not be updated, so it is unchanged'), true);
  check('a stale PDF is dropped when the ledger changes',
    hook.includes('deleteBillPdf(write.staleInvoiceNumber)'), true);

  section('the shortcut is not gated behind a dialog, and never un-pays');
  check('no confirmation on the tap', /tapTag[\s\S]{0,400}?Alert\.alert/.test(hook), false);
  // There is no honest answer to which of several instalments an un-pay would
  // delete, so it does not offer one.
  check('and it never deletes a payment', /deletePayment/.test(hook), false);

  section('the tappable tag looks tappable');
  // BOTH filled variants checked separately. An OR across them once passed with
  // the icon removed from the filled pill — the one on nearly every row —
  // because a rarer variant still had its own. Found by a negative control.
  check('the filled pill carries the affordance icon',
    /<Text style=\{styles.tagText\}>\{label\}<\/Text>\s*\{interactive \? <Ionicons/.test(tags), true);
  check('the outlined pill carries it too',
    /tagOutlineText\]\}>\{label\}<\/Text>\s*\{interactive \? \(\s*<Ionicons/.test(tags), true);
  check('the part-paid pill carries it as well',
    /tagPartialText\]\}>\{label\}<\/Text>\s*\{interactive \? \(\s*<Ionicons/.test(tags), true);
  check('and every variant is gated on interactive',
    (tags.match(/interactive \?/g) || []).length, 3);
  check('there is a press state', tags.includes('tagPressed'), true);
  check('the press state is distinct from the busy state',
    tags.includes('tagBusy') && tags.includes('tagPressed'), true);
  check('the read-only type tag has no icon',
    /accessibilityLabel=\{`\$\{paymentType\} sale`\}[\s\S]{0,200}?Ionicons/.test(tags), false);

  section('part paid is visually separable from not paid');
  // Two solid ambers side by side in a list are not tellable apart, which is
  // why the fill differs rather than the hue.
  check('part paid is tinted and outlined', tags.includes('tagPartial'), true);
  check('rather than another solid fill',
    /tagPartial: \{\s*backgroundColor: Colors\.lowStockTint/.test(tags), true);
}

module.exports = { run };
