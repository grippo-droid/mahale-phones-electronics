import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import ProductForm, { type ProductFormValues } from '@/components/ProductForm';
import StockAdjuster from '@/components/StockAdjuster';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import {
  deleteProduct,
  getProductById,
  updateProduct,
  type NewProduct,
  type Product,
} from '@/db/products';

/**
 * Edit Product (T2.4), with delete (T2.5) and manual stock adjustment (T2.6).
 */
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
      // Stock is owned by StockAdjuster on this screen and has already been
      // written; the form's copy is stale by definition, so it is dropped.
      const { stock_qty: _ignored, ...detailsOnly } = updates;
      await updateProduct(productId, detailsOnly);
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!product) return;

    Alert.alert(
      `Delete ${product.name}?`,
      'This removes the product from your inventory. Past bills that include it are not ' +
        'affected — they keep their own record of the name and price, so old invoices stay ' +
        'correct and can still be reprinted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteProduct(productId);
              router.back();
            } catch (err) {
              Alert.alert('Could not delete', err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
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
      showStockField={false}
      footer={
        <>
          <StockAdjuster product={product} onChanged={setProduct} />

          <Pressable
            style={[styles.deleteButton, busy && styles.disabled]}
            onPress={confirmDelete}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${product.name}`}>
            <Ionicons name="trash-outline" size={20} color={Colors.outOfStock} />
            <Text style={styles.deleteText}>Delete product</Text>
          </Pressable>
        </>
      }
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
    priceIncludesGst: product.priceIncludesGst,
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
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    minHeight: Spacing.minTapTarget,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.outOfStock,
  },
  deleteText: { fontSize: FontSizes.body, color: Colors.outOfStock, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
