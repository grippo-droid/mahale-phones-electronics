import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import Toast from '@/components/Toast';
import { initDatabase } from '@/db/init';
import { Colors, FontSizes, Spacing } from '@/constants/theme';
import { useSettingsStore } from '@/store/settings';

export default function RootLayout() {
  const [dbError, setDbError] = useState<Error | null>(null);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    initDatabase()
      // Load the shop's own details before any screen renders. The tax split
      // and every bill header read from this store, so a screen that mounts
      // first would briefly work off the placeholder defaults (T4.1).
      .then(() => useSettingsStore.getState().load())
      .then(() => {
        if (!cancelled) setDbReady(true);
      })
      .catch((error: Error) => {
        if (!cancelled) setDbError(error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing in the app works without the database, so gate the whole UI on it
  // rather than letting each screen fail on its own.
  if (dbError) {
    return (
      <View style={styles.centered}>
        <StatusBar style="dark" />
        <Text style={styles.errorTitle}>Could not open the database</Text>
        <Text style={styles.errorBody}>{dbError.message}</Text>
      </View>
    );
  }

  if (!dbReady) {
    return (
      <View style={styles.centered}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={Colors.brand} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.brand },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '600' },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="inventory/add" options={{ title: 'Add Product' }} />
        <Stack.Screen name="inventory/[id]" options={{ title: 'Edit Product' }} />
        <Stack.Screen name="bill/new" options={{ title: 'New Bill' }} />
        <Stack.Screen name="bill/[id]" options={{ title: 'Bill' }} />
        {/* Declared here so there is always a sensible title. Both screens set
            their own once they know what they are showing — the reference
            number, or "Edit Quotation" — but a dynamic route with no entry
            falls back to the route name, so the header read "[id]" while a
            quotation loaded and stayed that way if it was not found. */}
        <Stack.Screen name="quotation/new" options={{ title: 'New Quotation' }} />
        <Stack.Screen name="quotation/[id]" options={{ title: 'Quotation' }} />
      </Stack>

      {/* Mounted once, above every screen, because several actions report on a
          different screen from the one that started them — adding a product
          navigates back to Inventory before it can say anything. */}
      <Toast />
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },
  errorTitle: {
    fontSize: FontSizes.title,
    fontWeight: '700',
    color: Colors.outOfStock,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: FontSizes.body,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
