import { phoneDigits } from '@/lib/customer';

/**
 * Filling a customer's name and number from the phone's address book.
 *
 * An assist, never a picker. The field stays free text: most walk-in customers
 * are not in anyone's contacts, and a shop cannot be made to add someone to the
 * address book before it can bill them. Everything here degrades to nothing.
 *
 * ---------------------------------------------------------------------------
 * What this module must never do.
 *
 * The address book is the owner's personal one — family, suppliers, everyone.
 * The app reads it to answer one question ("what is this person's number?") and
 * keeps nothing. No contact is written to SQLite, so no contact reaches a
 * backup file, and the backup format does not change. The only thing that is
 * ever stored is the name and number the owner picked, on the bill they were
 * already making, which they would otherwise have typed by hand.
 *
 * There is no WRITE_CONTACTS. `expo-contacts`'s config plugin adds it
 * unconditionally and offers no way to turn it off, so `app.json` blocks it —
 * see the note in CLAUDE.md. The app only ever reads.
 * ---------------------------------------------------------------------------
 *
 * The native module is reached through `ContactsReader` rather than imported
 * directly, for the reason `RestoreIo` exists: the interesting logic is the
 * permission ladder and the shape of the suggestions, and neither can be
 * exercised with a real address book in a test. The reader is injected, the
 * logic is pure, and the parts that genuinely need a device are small enough
 * to check by hand.
 */

/** Below this a search would match most of the address book. */
export const MIN_SEARCH_LENGTH = 2;

/** Enough to scroll, few enough not to bury the form. */
export const MAX_SUGGESTIONS = 8;

// ---------------------------------------------------------------------------
// What the reader returns
// ---------------------------------------------------------------------------

/** The subset of a contact this app asks for. Nothing else is requested. */
export type RawContact = {
  id?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  phones?: { id?: string | null; number?: string | null; label?: string | null }[] | null;
};

export type PermissionLike = {
  granted: boolean;
  canAskAgain: boolean;
};

export type ContactsReader = {
  getPermission: () => Promise<PermissionLike>;
  requestPermission: () => Promise<PermissionLike>;
  search: (term: string, limit: number) => Promise<RawContact[]>;
};

// ---------------------------------------------------------------------------
// The permission ladder
// ---------------------------------------------------------------------------

/**
 * What the screen should do, given what Android currently says.
 *
 *   - `ready`       — search as the owner types.
 *   - `ask`         — explain first, then request. Only ever from 'undetermined'.
 *   - `unavailable` — do nothing at all, and never mention it again.
 *
 * There is deliberately no fourth state for "denied but we could ask again".
 * Android stops showing the dialog after a refusal, so an app that keeps
 * requesting produces nothing but a button that appears to do nothing. A "no"
 * is taken as final, and the only way back is the row in Settings, which the
 * owner has to go looking for.
 */
export type ContactsAccess = 'ready' | 'ask' | 'unavailable';

export function accessFor(permission: PermissionLike | null): ContactsAccess {
  if (!permission) return 'unavailable';
  if (permission.granted) return 'ready';
  return permission.canAskAgain ? 'ask' : 'unavailable';
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export type ContactSuggestion = {
  /** Stable list key. One contact with three numbers gives three rows. */
  key: string;
  /** The contact's display name. */
  name: string;
  /** "mobile", "work" — whatever the address book calls it. Null if unlabelled. */
  label: string | null;
  /**
   * Shown to the owner: the number exactly as the address book holds it.
   * That is what makes a contact recognisable, and what tells two of their
   * numbers apart.
   */
  displayPhone: string;
  /**
   * Written into the Phone field: the same number reduced to digits.
   *
   * This matters more than it looks. `normaliseCustomer` stores the phone as
   * typed, and History searches it with LIKE — so a bill filled with
   * "+91 98263 51449" would not be found by searching "9826351449", and the
   * same customer's spend would split across two formats. `phoneDigits` is
   * already what validation reduces a typed number to, so filling with it puts
   * exactly what the owner would have typed into the field.
   */
  phone: string;
};

export function contactName(contact: RawContact): string {
  return [contact.givenName, contact.familyName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

/**
 * Flattens contacts into one row per phone number.
 *
 * A contact with three numbers becomes three rows rather than one row and a
 * sub-picker: picking is then a single tap, and there is no second state to
 * design, dismiss or get stuck in. The name repeats down the rows, which is
 * what makes it read as "these are all Ramesh".
 *
 * A contact with NO usable number is still offered, with just its name (T9.5).
 * That reasoning changed when the phone became optional: it used to be dropped
 * because it "could not fill the field", which stopped being true the moment a
 * bill could be raised without a number. A contact with a name is still worth a
 * tap — it fills the name and leaves the phone alone.
 *
 * A contact with no NAME is still dropped, in both cases: a row the owner
 * cannot recognise is not a choice, it is a puzzle.
 */
export function toSuggestions(contacts: RawContact[]): ContactSuggestion[] {
  const suggestions: ContactSuggestion[] = [];
  const seen = new Set<string>();

  contacts.forEach((contact, contactIndex) => {
    const name = contactName(contact);
    if (name.length === 0) return;

    const usable = (contact.phones ?? []).filter((phone) => {
      const raw = (phone?.number ?? '').trim();
      return raw.length > 0 && phoneDigits(raw).length > 0;
    });

    if (usable.length === 0) {
      // Name only. `phone` is empty rather than absent, so picking this row
      // writes an empty string into the field — which is exactly what the
      // owner would leave it as.
      suggestions.push({
        key: `${contact.id ?? contactIndex}:name-only`,
        name,
        label: null,
        displayPhone: '',
        phone: '',
      });
      return;
    }

    usable.forEach((phone, phoneIndex) => {
      const raw = (phone?.number ?? '').trim();
      const digits = phoneDigits(raw);

      // The same number twice under one contact is an address-book artefact,
      // not a choice worth offering.
      const dedupe = `${name}|${digits}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);

      const label = (phone?.label ?? '').trim();
      suggestions.push({
        key: `${contact.id ?? contactIndex}:${phone?.id ?? phoneIndex}`,
        name,
        label: label.length > 0 ? label : null,
        displayPhone: raw,
        phone: digits,
      });
    });
  });

  return suggestions;
}

/** True when a typed name is worth looking up at all. */
export function shouldSearch(term: string): boolean {
  return term.trim().length >= MIN_SEARCH_LENGTH;
}

// ---------------------------------------------------------------------------
// The real reader
// ---------------------------------------------------------------------------

/**
 * `expo-contacts` is imported lazily, inside each call.
 *
 * Everything above is ordinary TypeScript and is tested without a device; a
 * top-level import of a native module would drag it into that. It also means
 * a build where the module is missing degrades to `unavailable` rather than
 * failing to start.
 */
export const contactsReader: ContactsReader = {
  getPermission: async () => {
    try {
      const Contacts = await import('expo-contacts');
      const { granted, canAskAgain } = await Contacts.getPermissionsAsync();
      return { granted, canAskAgain };
    } catch {
      return { granted: false, canAskAgain: false };
    }
  },

  requestPermission: async () => {
    try {
      const Contacts = await import('expo-contacts');
      const { granted, canAskAgain } = await Contacts.requestPermissionsAsync();
      return { granted, canAskAgain };
    } catch {
      return { granted: false, canAskAgain: false };
    }
  },

  search: async (term, limit) => {
    try {
      const Contacts = await import('expo-contacts');
      // Only these three fields are asked for. Reading addresses, emails or
      // birthdays would be reading more of the owner's address book than the
      // question needs.
      const found = await Contacts.Contact.getAllDetails(
        [Contacts.ContactField.GIVEN_NAME, Contacts.ContactField.FAMILY_NAME, Contacts.ContactField.PHONES],
        { name: term, limit }
      );
      return found as RawContact[];
    } catch {
      // A failed lookup is not an error the owner can act on — the field still
      // works. Saying nothing is right.
      return [];
    }
  },
};
