import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';
import {
  accessFor,
  contactsReader,
  MAX_SUGGESTIONS,
  shouldSearch,
  toSuggestions,
  type ContactsAccess,
  type ContactsReader,
  type ContactSuggestion,
} from '@/lib/contacts';

/**
 * Type-ahead over the phone's address book for the customer's name.
 *
 * The list renders in normal flow, directly beneath the field, pushing the
 * rest of the form down. Not an absolutely-positioned dropdown: both forms
 * that use this sit inside a ScrollView, and on Android an overlay is clipped
 * by it. Pushing content down also cannot cover the field being typed into.
 *
 * Nothing here is required. Every failure — no permission, no module, a search
 * that throws, an address book with nobody in it — results in no list and no
 * message, which leaves the field exactly as it was before this existed.
 */

/** Matches the product search, so the two feel the same under the thumb. */
const SEARCH_DEBOUNCE_MS = 250;

type ContactsState = {
  suggestions: ContactSuggestion[];
  access: ContactsAccess | null;
  explaining: boolean;
  allow: () => void;
  decline: () => void;
  /** Called by the screen once a suggestion has been used. */
  accept: (suggestion: ContactSuggestion) => void;
};

/**
 * Drives the lookup, the permission ladder and the one-time explanation.
 *
 * The reader is a parameter so the screens get the real address book and a
 * test gets a fake — see `lib/contacts.ts` for why that seam exists.
 */
export function useContactSuggestions(term: string, reader: ContactsReader = contactsReader): ContactsState {
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [access, setAccess] = useState<ContactsAccess | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [debounced, setDebounced] = useState(term);

  /**
   * The name that was just filled in from a suggestion.
   *
   * Without this the list reappears underneath the field the moment it is
   * filled, because the typed term now matches a contact exactly — the owner
   * would pick Ramesh and be shown Ramesh again.
   */
  const acceptedName = useRef<string | null>(null);

  /** Drops a slower earlier reply, the same guard the product searches use. */
  const requestId = useRef(0);

  /**
   * Set when the owner dismisses the explanation without deciding.
   *
   * Deliberately in memory and not in `app_settings`: it is a "not right now",
   * not an answer, and the real answer lives with Android. Asking once more
   * the next time the app is opened is not nagging; asking again on the next
   * bill would be. A genuine Android refusal never comes back here at all —
   * it lands as `unavailable`, which is permanent.
   */
  const [postponed, setPostponed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const clear = useCallback(() => {
    requestId.current += 1;
    setSuggestions([]);
  }, []);

  const run = useCallback(
    async (search: string) => {
      const id = ++requestId.current;
      const found = await reader.search(search, MAX_SUGGESTIONS);
      if (id !== requestId.current) return;
      setSuggestions(toSuggestions(found).slice(0, MAX_SUGGESTIONS));
    },
    [reader]
  );

  useEffect(() => {
    const search = debounced.trim();

    if (!shouldSearch(search) || search === acceptedName.current) {
      clear();
      return;
    }

    let active = true;

    (async () => {
      // Ask Android what it currently thinks rather than keeping a flag of our
      // own. A second copy of this fact would be free to disagree with it —
      // the owner can change it in Android Settings while the app is open.
      const current = access ?? accessFor(await reader.getPermission());
      if (!active) return;
      if (access !== current) setAccess(current);

      if (current === 'unavailable') return;
      if (current === 'ask') {
        if (!postponed) setExplaining(true);
        return;
      }

      await run(search);
    })();

    return () => {
      active = false;
    };
  }, [debounced, access, postponed, reader, run, clear]);

  const allow = useCallback(async () => {
    setExplaining(false);
    const granted = accessFor(await reader.requestPermission());
    setAccess(granted);
    if (granted === 'ready') await run(debounced.trim());
  }, [reader, run, debounced]);

  const decline = useCallback(() => {
    setExplaining(false);
    setPostponed(true);
  }, []);

  const accept = useCallback(
    (suggestion: ContactSuggestion) => {
      acceptedName.current = suggestion.name;
      clear();
    },
    [clear]
  );

  return { suggestions, access, explaining, allow, decline, accept };
}

// ---------------------------------------------------------------------------

export default function ContactSuggestions({
  state,
  onPick,
}: {
  state: ContactsState;
  onPick: (suggestion: ContactSuggestion) => void;
}) {
  const { suggestions, explaining, allow, decline, accept } = state;

  return (
    <>
      {suggestions.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.caption}>From your contacts — or keep typing</Text>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.key}
              onPress={() => {
                accept(suggestion);
                onPick(suggestion);
              }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Use ${suggestion.name}, ${suggestion.displayPhone}`}>
              <Ionicons name="person-circle-outline" size={22} color={Colors.textMuted} />
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {suggestion.name}
                </Text>
                <Text style={styles.number} numberOfLines={1}>
                  {suggestion.displayPhone}
                  {suggestion.label ? ` · ${suggestion.label}` : ''}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Shown before Android's own dialog, once. It explains why a billing app
          is asking for the address book at all — which the system dialog does
          not say, and which is the whole difference between a reasonable
          request and an alarming one. It is informational: "Not now" is a
          perfectly good answer and costs nothing. */}
      <Modal visible={explaining} transparent animationType="fade" onRequestClose={decline}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Ionicons name="people-outline" size={32} color={Colors.brand} />
            <Text style={styles.cardTitle}>Fill in a customer from your contacts?</Text>
            <Text style={styles.cardBody}>
              Mahale Phones and Electronics would like to check your Contacts so you can quickly fill
              in a customer&apos;s name and number. Nothing from your contacts is saved or shared —
              only the name and number you pick go onto the bill.
            </Text>
            <Text style={styles.cardBody}>You can still type them in yourself if you skip this.</Text>

            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
              onPress={allow}
              accessibilityRole="button">
              <Text style={styles.primaryText}>Check contacts</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
              onPress={decline}
              accessibilityRole="button">
              <Text style={styles.secondaryText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: Spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  caption: {
    fontSize: FontSizes.small - 2,
    color: Colors.textMuted,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: Spacing.minTapTarget,
  },
  rowPressed: { backgroundColor: Colors.brandTint },
  rowText: { flex: 1 },
  name: { fontSize: FontSizes.body, color: Colors.text, fontWeight: '600' },
  number: { fontSize: FontSizes.small, color: Colors.textMuted },

  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  card: {
    width: '100%',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: 12,
    backgroundColor: Colors.background,
  },
  cardTitle: {
    fontSize: FontSizes.title,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  cardBody: { fontSize: FontSizes.small, color: Colors.textMuted, textAlign: 'center' },

  primary: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
    minHeight: Spacing.minTapTarget,
    borderRadius: 10,
    backgroundColor: Colors.brand,
  },
  primaryPressed: { backgroundColor: Colors.brandDark },
  primaryText: { fontSize: FontSizes.body, fontWeight: '700', color: '#FFFFFF' },

  secondary: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: Spacing.minTapTarget,
    borderRadius: 10,
  },
  secondaryPressed: { backgroundColor: Colors.surface },
  secondaryText: { fontSize: FontSizes.body, fontWeight: '600', color: Colors.textMuted },
});
