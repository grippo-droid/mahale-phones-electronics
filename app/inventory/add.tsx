import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import ProductForm, { EMPTY_PRODUCT_FORM } from '@/components/ProductForm';
import { createProduct, type NewProduct } from '@/db/products';
import { showToast } from '@/store/toast';
import { useNewProductStore, type NewProductTarget } from '@/store/newProduct';

/**
 * Add Product (T2.3), also reachable from inside a bill or quotation (T9.4).
 *
 * `addTo` says who asked — Billing or the quotation editor — and `name`
 * pre-fills whatever had been typed into the search box when nothing matched.
 * The form itself is the same one Inventory uses, every field and nothing
 * shortened: a product created mid-sale is a real product, and one entered
 * through a cut-down form would be missing its HSN code on the invoice it is
 * about to appear on.
 *
 * With `addTo` set the created product is handed to that screen, which asks
 * how many and adds it. Without it this behaves exactly as it always has.
 */
export default function AddProductScreen() {
  const params = useLocalSearchParams<{ addTo?: string; name?: string }>();
  const [busy, setBusy] = useState(false);
  const hand = useNewProductStore((state) => state.hand);

  const target: NewProductTarget | null =
    params.addTo === 'bill' || params.addTo === 'quotation' ? params.addTo : null;

  const handleSubmit = async (product: NewProduct) => {
    setBusy(true);
    try {
      const created = await createProduct(product);
      // Named, not just "Saved": the Inventory list is alphabetical, so a new
      // product lands mid-list rather than at the top and can be genuinely hard
      // to spot among thirty others. The name is the confirmation.
      showToast(`Saved — ${product.name.trim()}`);
      if (target) hand(created, target);
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProductForm
      // Only the name is carried across. It is what the owner typed looking for
      // the product, so it is the one field already known.
      initialValues={
        params.name ? { ...EMPTY_PRODUCT_FORM, name: params.name } : EMPTY_PRODUCT_FORM
      }
      submitLabel="Save product"
      busy={busy}
      onSubmit={handleSubmit}
    />
  );
}
