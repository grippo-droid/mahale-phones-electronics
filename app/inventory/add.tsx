import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import ProductForm from '@/components/ProductForm';
import { createProduct, type NewProduct } from '@/db/products';
import { showToast } from '@/store/toast';

/** Add Product (T2.3). */
export default function AddProductScreen() {
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (product: NewProduct) => {
    setBusy(true);
    try {
      await createProduct(product);
      // Named, not just "Saved": the Inventory list is alphabetical, so a new
      // product lands mid-list rather than at the top and can be genuinely hard
      // to spot among thirty others. The name is the confirmation.
      showToast(`Saved — ${product.name.trim()}`);
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return <ProductForm submitLabel="Save product" busy={busy} onSubmit={handleSubmit} />;
}
