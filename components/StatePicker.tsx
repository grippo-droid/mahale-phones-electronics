import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ACTIVE_STATES, findStateByName, type IndianState } from '@/constants/states';
import { Colors, FontSizes, Spacing } from '@/constants/theme';

/**
 * Picks a state from the fixed list (T3.4).
 *
 * A modal with a search box rather than the chip row used for product
 * categories: six categories fit on a screen, thirty-six states do not, and a
 * wrapped grid of them would be a wall of text to read at a counter.
 *
 * The shop's own state is pinned to the top when it is known. Nearly every sale
 * is local, so the common case should be the first thing under the thumb rather
 * than something to scroll or spell out.
 */

type Props = {
  value: string;
  onChange: (stateName: string) => void;
  /** Pinned to the top as the likely answer. Omitted when still a placeholder. */
  homeState?: string | null;
  label?: string;
  error?: string | null;
};

export default function StatePicker({ value, onChange, homeState, label, error }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const home = homeState ? findStateByName(homeState) : null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return ACTIVE_STATES;
    // Matching the code too means "27" finds Maharashtra — quicker than the
    // name for anyone reading a state off a GSTIN.
    return ACTIVE_STATES.filter(
      (state) => state.name.toLowerCase().includes(term) || state.code.includes(term)
    );
  }, [search]);

  const selected = findStateByName(value);

  const choose = (state: IndianState) => {
    onChange(state.name);
    setSearch('');
    setOpen(false);
  };

  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable
        style={[styles.trigger, error ? styles.triggerError : null]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={selected ? `State: ${selected.name}. Change it.` : 'Choose the state'}>
        <Text style={selected ? styles.triggerValue : styles.triggerPlaceholder}>
          {selected ? selected.name : 'Choose a state'}
        </Text>
        <Ionicons name="chevron-down" size={20} color={Colors.textMuted} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal
        visible={open}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Customer’s state</Text>
            <Pressable
              onPress={() => setOpen(false)}
              hitSlop={Spacing.md}
              accessibilityRole="button"
              accessibilityLabel="Close without changing the state">
              <Ionicons name="close" size={26} color={Colors.text} />
            </Pressable>
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search state or GST code"
              placeholderTextColor={Colors.textMuted}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoFocus
              accessibilityLabel="Search for a state"
            />
          </View>

          {home && search.trim().length === 0 ? (
            <Pressable
              style={({ pressed }) => [styles.row, styles.homeRow, pressed && styles.rowPressed]}
              onPress={() => choose(home)}
              accessibilityRole="button"
              accessibilityLabel={`${home.name} — same state as the shop`}>
              <View style={styles.rowMain}>
                <Text style={styles.rowName}>{home.name}</Text>
                <Text style={styles.homeHint}>Same state as the shop — CGST + SGST</Text>
              </View>
              <Text style={styles.rowCode}>{home.code}</Text>
            </Pressable>
          ) : null}

          <FlatList
            data={filtered}
            keyExtractor={(state) => state.code}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>No state matches “{search.trim()}”.</Text>
            }
            renderItem={({ item }) => {
              const active = selected?.code === item.code;
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => choose(item)}
                  accessibilityRole="button"
                  accessibilityLabel={item.name}>
                  <View style={styles.rowMain}>
                    <Text style={[styles.rowName, active && styles.rowNameActive]}>{item.name}</Text>
                  </View>
                  {active ? (
                    <Ionicons name="checkmark" size={22} color={Colors.brand} />
                  ) : (
                    <Text style={styles.rowCode}>{item.code}</Text>
                  )}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.xs },
  label: { fontSize: FontSizes.small, fontWeight: '600', color: Colors.textMuted },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: Spacing.minTapTarget,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  triggerError: { borderColor: Colors.outOfStock },
  triggerValue: { fontSize: FontSizes.body, color: Colors.text, fontWeight: '600' },
  triggerPlaceholder: { fontSize: FontSizes.body, color: Colors.textMuted },
  error: { fontSize: FontSizes.small, color: Colors.outOfStock },

  modal: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    margin: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: Spacing.minTapTarget,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: FontSizes.body, color: Colors.text },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: Spacing.minTapTarget + 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  homeRow: { backgroundColor: Colors.surface },
  rowPressed: { backgroundColor: Colors.surface },
  rowMain: { flex: 1, gap: 2 },
  rowName: { fontSize: FontSizes.body, color: Colors.text },
  rowNameActive: { fontWeight: '700', color: Colors.brand },
  rowCode: { fontSize: FontSizes.small, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
  homeHint: { fontSize: FontSizes.small, color: Colors.inStock, fontWeight: '600' },
  empty: { padding: Spacing.lg, textAlign: 'center', color: Colors.textMuted, fontSize: FontSizes.body },
});
