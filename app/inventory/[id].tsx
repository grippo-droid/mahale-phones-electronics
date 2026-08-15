import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import ProductForm, { type ProductFormValues } from '@/components/ProductForm';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { getProductById, updateProduct, type NewProduct, type Product } from '@/db/products';

/** Edit Product (T2.4). Delete (T2.5) and stock adjustment (T2.6) are added here next. */
export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();

  const productId = Number(id);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!Number.isFinite(productId)) throw new Error('That product link is not valid.');
        const found = await getProductById(productId);
        if (cancelled) return;
        if (!found) throw new Error('This product no longer exists.');
        setProduct(found);
        navigation.setOptions({ title: found.name });
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productId, navigation]);

  const handleSubmit = async (updates: NewProduct) => {
    setBusy(true);
    try {
      await updateProduct(productId, updates);
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  if (loadError || !product) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Product not found</Text>
        <Text style={styles.errorBody}>{loadError}</Text>
      </View>
    );
  }

  return (
    <ProductForm
      initialValues={toFormValues(product)}
      submitLabel="Save changes"
      busy={busy}
      onSubmit={handleSubmit}
    />
  );
}

function toFormValues(product: Product): ProductFormValues {
  return {
    name: product.name,
    category: product.category,
    stockQty: String(product.stock_qty),
    unitPrice: String(product.unit_price),
    gstRate: product.gst_rate,
    hsnCode: product.hsn_code ?? '',
    brand: product.brand ?? '',
    modelNumber: product.model_number ?? '',
    // Blank means "use the shop-wide default", which is exactly what NULL means.
    lowStockThreshold:
      product.low_stock_threshold === null ? '' : String(product.low_stock_threshold),
  };
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.sm,
    backgroundColor: Colors.background,
  },
  errorTitle: { fontSize: FontSizes.title, fontWeight: '700', color: Colors.text },
  errorBody: { fontSize: FontSizes.body, color: Colors.textMuted, textAlign: 'center' },
});
