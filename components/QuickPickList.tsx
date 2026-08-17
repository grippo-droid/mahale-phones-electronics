import { StyleSheet, Text, View } from 'react-native';

import ProductPickRow from '@/components/ProductPickRow';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import type { FrequentlySoldProduct, Product } from '@/db/products';

/**
 * What the Billing screen offers before anything is searched for (T3.8).
 *
 * Either the frequently sold products, or — when there is not enough sales
 * history to rank anything honestly — the catalogue grouped by category. Both
 * are the same shape on screen: headed sections of tappable products.
 *
 * The heading says which of the two it is, and the caption sits directly under
 * that heading. A ranking presented without saying what it is based on invites
 * the owner to read meaning into an order that may just be the only three
 * things ever sold.
 */

export type QuickPickSection = {
  title: string;
  /** Explains the ranking. Rendered under its own heading, never above it. */
  caption?: string | null;
  products: (Product | FrequentlySoldProduct)[];
};

type Props = {
  sections: QuickPickSection[];
  inCart: Map<number, number>;
  onAdd: (product: Product) => void;
  /**
   * Draws a strong break above the block.
   *
   * Used when these suggestions follow the bill itself: without it the two run
   * together as one list and it stops being obvious which rows are on the bill
   * and which are merely on offer.
   */
  separated?: boolean;
};

function unitsSoldOf(product: Product | FrequentlySoldProduct): number | undefined {
  return 'unitsSold' in product ? product.unitsSold : undefined;
}

export default function QuickPickList({ sections, inCart, onAdd, separated = false }: Props) {
  if (sections.length === 0) return null;

  return (
    <View style={[styles.block, separated && styles.blockSeparated]}>
      {separated ? (
        <Text style={styles.breakLabel}>Not on the bill — tap to add</Text>
      ) : null}

      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.heading}>{section.title}</Text>
          {section.caption ? <Text style={styles.caption}>{section.caption}</Text> : null}

          <View style={styles.rows}>
            {section.products.map((product) => (
              <ProductPickRow
                key={product.id}
                product={product}
                qtyInCart={inCart.get(product.id)}
                unitsSold={unitsSoldOf(product)}
                onAdd={onAdd}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: Colors.background },
  blockSeparated: {
    marginTop: Spacing.lg,
    borderTopWidth: 8,
    borderTopColor: Colors.surface,
    paddingTop: Spacing.sm,
  },
  breakLabel: {
    fontSize: FontSizes.small,
    color: Colors.textMuted,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
  },
  section: { paddingTop: Spacing.sm },
  heading: {
    fontSize: FontSizes.body,
    fontWeight: '700',
    color: Colors.text,
    paddingHorizontal: Spacing.md,
  },
  caption: {
    fontSize: FontSizes.small,
    color: Colors.textMuted,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  rows: { paddingTop: Spacing.xs },
});
