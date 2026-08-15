import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import ProductForm from '@/components/ProductForm';
import { createProduct, type NewProduct } from '@/db/products';

/** Add Product (T2.3). */
export default function AddProductScreen() {
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (product: NewProduct) => {
    setBusy(true);
    try {
      await createProduct(product);
      // The Inventory list reloads on focus, so returning to it is the
      // confirmation that the product saved. T7.3 adds an explicit toast.
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return <ProductForm submitLabel="Save product" busy={busy} onSubmit={handleSubmit} />;
}
