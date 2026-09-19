'use strict';

/**
 * Filling a customer from the phone's address book (T9.1).
 *
 * Scope, stated plainly. There is no address book here, no permission dialog
 * and no renderer, so this cannot prove the feature works on a phone. What it
 * CAN prove is the part where the bugs actually are:
 *
 *   - the number that lands in the field, which decides whether History can
 *     still find that customer afterwards;
 *   - the permission ladder, including that a refusal is final and silent;
 *   - the flattening of a contact with several numbers.
 *
 * The reader seam exists exactly so this much is reachable without a device.
 */

const { readSource } = require('../harness/check');
const {
  accessFor,
  contactName,
  toSuggestions,
  shouldSearch,
  MIN_SEARCH_LENGTH,
} = require('@/lib/contacts');

async function run({ check, section }) {
  section('the number that lands in the field');
  // The check that matters most. normaliseCustomer stores the phone as typed
  // and History searches it with LIKE, so a contact's "+91 98263 51449" going
  // in verbatim would make that bill unfindable by searching the number — and
  // would split one customer's spend across two formats.
  const formats = [
    ['plain ten digits', '9826351449'],
    ['with the country code', '+91 98263 51449'],
    ['country code, no spaces', '+919826351449'],
    ['a leading zero', '09826351449'],
    ['spaced out', '98263 51449'],
    ['dashed', '98263-51449'],
    ['bracketed', '(98263) 51449'],
  ];
  for (const [label, raw] of formats) {
    const [suggestion] = toSuggestions([
      { id: 'c1', givenName: 'Ramesh', familyName: 'Kumar', phones: [{ id: 'p1', number: raw }] },
    ]);
    check(`${label} fills as 9826351449`, suggestion.phone, '9826351449');
  }

  section('and the owner still sees the number they recognise');
  const [shown] = toSuggestions([
    { id: 'c1', givenName: 'Ramesh', phones: [{ id: 'p1', number: '+91 98263 51449' }] },
  ]);
  check('the address book form is displayed', shown.displayPhone, '+91 98263 51449');
  check('while the field gets the digits', shown.phone, '9826351449');

  section('a contact with several numbers becomes several rows');
  // One tap rather than two: no sub-picker, no second state to get stuck in.
  const many = toSuggestions([
    {
      id: 'c2',
      givenName: 'Suresh',
      familyName: 'Patel',
      phones: [
        { id: 'p1', number: '9826351449', label: 'mobile' },
        { id: 'p2', number: '0733 245 1122', label: 'work' },
      ],
    },
  ]);
  check('one row per number', many.length, 2);
  check('the name repeats, so they read as one person',
    many.map((s) => s.name), ['Suresh Patel', 'Suresh Patel']);
  check('the label tells them apart', many.map((s) => s.label), ['mobile', 'work']);
  check('each row has its own key', new Set(many.map((s) => s.key)).size, 2);

  section('rows that could not fill the field are not offered');
  const junk = toSuggestions([
    { id: 'a', givenName: 'No Number', phones: [] },
    { id: 'b', givenName: 'Null Phones', phones: null },
    { id: 'c', givenName: 'Empty String', phones: [{ number: '   ' }] },
    { id: 'd', givenName: 'No Digits', phones: [{ number: '---' }] },
    { id: 'e', givenName: '', phones: [{ number: '9826351449' }] },
  ]);
  check('nothing offered that cannot be used', junk, []);

  section('the same number twice under one contact is offered once');
  const dupes = toSuggestions([
    {
      id: 'c3',
      givenName: 'Anita',
      phones: [
        { id: 'p1', number: '9826351449' },
        { id: 'p2', number: '+91 98263 51449' },
      ],
    },
  ]);
  check('an address-book artefact is not a choice', dupes.length, 1);

  section('names');
  check('given and family are joined',
    contactName({ givenName: 'Ramesh', familyName: 'Kumar' }), 'Ramesh Kumar');
  check('a missing family name does not leave a space',
    contactName({ givenName: 'Ramesh', familyName: null }), 'Ramesh');
  check('a missing given name still works',
    contactName({ givenName: null, familyName: 'Kumar' }), 'Kumar');

  section('when to look at all');
  check(`nothing below ${MIN_SEARCH_LENGTH} characters`, shouldSearch('r'), false);
  check('a blank field never searches', shouldSearch('   '), false);
  check('two characters is enough', shouldSearch('ra'), true);

  section('the permission ladder');
  check('granted means search', accessFor({ granted: true, canAskAgain: false }), 'ready');
  check('undetermined means explain first', accessFor({ granted: false, canAskAgain: true }), 'ask');
  // The one that matters: a refusal is final. Android stops showing its dialog
  // after a denial, so an app that keeps asking produces a control that appears
  // to do nothing.
  check('a refusal is permanent', accessFor({ granted: false, canAskAgain: false }), 'unavailable');
  check('no module at all is the same as no permission', accessFor(null), 'unavailable');

  section('the manifest asks to read contacts and nothing else');
  const appJson = JSON.parse(readSource('app.json'));
  const blocked = appJson.expo.android.blockedPermissions ?? [];
  // expo-contacts' config plugin adds WRITE_CONTACTS unconditionally and has no
  // option to turn it off, so this is the only thing standing between a billing
  // app and permission to edit the owner's address book.
  check('WRITE_CONTACTS is blocked',
    blocked.includes('android.permission.WRITE_CONTACTS'), true);
  check('the plugin is declared', appJson.expo.plugins.includes('expo-contacts'), true);

  section('nothing from the address book is ever stored');
  const source = readSource('lib/contacts.ts');
  check('the module never touches the database',
    /db\/|getDatabase|runAsync|execAsync/.test(source), false);
  check('only three fields are ever requested',
    /GIVEN_NAME[\s\S]{0,80}FAMILY_NAME[\s\S]{0,40}PHONES/.test(source), true);
  check('and no write API is referenced',
    /Contact\.(create|update|patch|delete|presentCreateForm)/.test(source), false);

  section('the screens fill both fields, never just the name');
  for (const [name, file] of [
    ['Billing', 'components/CustomerDetailsForm.tsx'],
    ['Quotation editor', 'app/quotation/new.tsx'],
  ]) {
    const screen = readSource(file);
    check(`${name} shows the suggestions`, screen.includes('<ContactSuggestions'), true);
    check(`${name} fills the name`, /'name',\s*suggestion\.name/.test(screen), true);
    check(`${name} fills the phone`, /'phone',\s*suggestion\.phone/.test(screen), true);
  }

  section('and Settings offers the way back, without nagging');
  const settings = readSource('app/(tabs)/settings.tsx');
  check('the row is hidden until Android has been asked',
    /contactsAccess === null \? null :/.test(settings), true);
  check('a refusal offers Android Settings', settings.includes('Linking.openSettings()'), true);
  check('and that button is only there once refused',
    /contactsAccess === 'unavailable' \? \(/.test(settings), true);
}

module.exports = { run };
