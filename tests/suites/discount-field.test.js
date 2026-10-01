'use strict';

/**
 * Choosing a discount type is a separate statement from giving the amount
 * (T9.11).
 *
 * ---------------------------------------------------------------------------
 * The bug: the ₹ chip could not be selected until a number had been typed.
 *
 *   selected type = discount?.type ?? 'percent'
 *
 * Tapping ₹ emitted the discount for the box as it stood. An empty box is no
 * discount, so `onChange(null)` went to the store, `discount` came back null,
 * and the type fell to its `?? 'percent'` default. The chip re-rendered as %
 * and the tap looked ignored. It only ever showed on ₹ because 'percent' IS
 * the fallback — tapping % did the same round trip and landed where it
 * started.
 *
 * What is testable here and what is not: `discountFromInput` is pure and is
 * unit-tested below. The type persisting across a null is React state in a
 * component, and there is no renderer, so that half is held by reading the
 * source. A build is what actually says the chip responds to a finger.
 * ---------------------------------------------------------------------------
 */

const { readSource, readSourceWithoutComments } = require('../harness/check');
const { discountFromInput, discountAmountFor } = require('@/lib/gst');
const { Spacing } = require('@/constants/theme');

async function run({ check, section }) {
  section('an unanswered box is no discount, not a discount of zero');
  // This behaviour is CORRECT and is kept. Clearing the amount must clear the
  // discount, or a line keeps a figure the owner has just deleted.
  for (const raw of ['', '   ', 'abc', '0', '0.00', '-5']) {
    check(`${JSON.stringify(raw)} is no discount`, discountFromInput('amount', raw), null);
  }

  section('a real number is the discount, under the type it was given');
  check('rupees', discountFromInput('amount', '100'), { type: 'amount', value: 100 });
  check('percent', discountFromInput('percent', '20'), { type: 'percent', value: 20 });
  check('a decimal survives', discountFromInput('amount', '12.5'), { type: 'amount', value: 12.5 });
  // Trailing-dot input is what stops the box being synced back from the prop:
  // it parses to a whole number, so echoing it would rewrite the keystroke.
  check('"5." parses to 5', discountFromInput('amount', '5.'), { type: 'amount', value: 5 });
  check('and that is why text is not echoed back',
    String(discountFromInput('amount', '5.').value) === '5.', false);

  section('the type is carried through, never re-derived');
  // The whole bug in one line: ₹ with an empty box yields null, and null has
  // no type to read back.
  check('rupees with an empty box yields null', discountFromInput('amount', ''), null);
  check('percent with an empty box yields the same null',
    discountFromInput('percent', ''), null);
  // So the two are indistinguishable downstream -- which is exactly why the
  // component must hold the choice itself.
  check('the two are indistinguishable from their result',
    JSON.stringify(discountFromInput('amount', '')) ===
      JSON.stringify(discountFromInput('percent', '')),
    true);

  section('and the money still comes off the way it did');
  check('a flat 100 off 900', discountAmountFor(900, discountFromInput('amount', '100')), 100);
  check('20 percent off 900', discountAmountFor(900, discountFromInput('percent', '20')), 180);
  check('no discount takes nothing', discountAmountFor(900, discountFromInput('amount', '')), 0);

  section('the component holds the chosen type as state');
  const source = readSourceWithoutComments('components/DiscountField.tsx');
  check('type is useState, not a derivation',
    /const \[type, setType\] = useState/.test(source), true);
  // The exact line that caused it. It must not come back.
  check('the type is no longer read off the prop',
    /const type = discount\?\.type/.test(source), false);
  check('tapping a chip sets it', /setType\(nextType\)/.test(source), true);

  section('a stored discount is followed, a cleared one is not');
  // Adjusted during render, which is the pattern T7.4 settled on -- an effect
  // paints the stale chip for a frame first.
  check('it keeps a last-seen tracker',
    /const \[lastSeenType, setLastSeenType\] = useState/.test(source), true);
  check('and compares during render, not in an effect',
    /useEffect\([^)]*setType/.test(source), false);
  // The guard that makes clearing safe: null must never reach setType.
  check('null is skipped explicitly',
    /if \(incomingType !== null && incomingType !== lastSeenType\)/.test(source), true);

  section('the typed amount is deliberately not synced back');
  check('nothing writes the prop into the text box',
    /setText\(.*discount\.value/.test(source), false);

  section('the chips are a real tap target');
  // 36dp with hitSlop would have reached 48 but overlapped by 8dp in the
  // middle, where one chip can take the other's tap -- the same shape as the
  // bug being fixed. They are 48 outright instead.
  check('the project standard is 48', Spacing.minTapTarget, 48);
  // Scoped to the chip's own style block. A bare search for the constant
  // matched the CLEAR button instead and stayed green with the chips reverted
  // to 36 -- found by running exactly that control.
  const chipStyle = (/chip: \{([\s\S]*?)\}/.exec(source) || [, ''])[1];
  check('the chip is 48 wide', /minWidth: Spacing\.minTapTarget/.test(chipStyle), true);
  check('and 48 tall', /minHeight: Spacing\.minTapTarget/.test(chipStyle), true);
  check('no 36dp target is left anywhere', /36/.test(source), false);
  check('and the chips carry no hitSlop to overlap with',
    /hitSlop[\s\S]{0,400}styles\.chip/.test(source), false);
  // The clear button grew too, so its old slop would have reached back over
  // the amount box.
  const full = readSource('components/DiscountField.tsx');
  check('the clear button has no hitSlop either',
    /hitSlop=\{Spacing\.sm\}\s*\n\s*style=\{styles\.clear\}/.test(full), false);
}

module.exports = { run };
