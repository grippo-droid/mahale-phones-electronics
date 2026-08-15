import { StyleSheet, Text, View } from 'react-native';

import { Colors, FontSizes, Spacing } from '@/constants/theme';

type Props = {
  title: string;
  /** Which ticket(s) from the Feature Ticket List will build this screen out. */
  buildsIn: string;
  description: string;
};

/**
 * Temporary stand-in used by the Phase 0 skeleton screens (T0.4) so navigation
 * can be verified before any real feature exists. Each screen replaces this
 * with its real UI in the ticket named by `buildsIn`.
 */
export default function PlaceholderScreen({ title, buildsIn, description }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>Built in {buildsIn}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },
  title: {
    fontSize: FontSizes.heading,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  description: {
    fontSize: FontSizes.body,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  badge: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  badgeText: {
    fontSize: FontSizes.small,
    color: Colors.textMuted,
    fontWeight: '600',
  },
});
