import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { initDatabase } from '@/db/init';
import { Colors, FontSizes, Spacing } from '@/constants/theme';

export default function RootLayout() {
  const [dbError, setDbError] = useState<Error | null>(null);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    initDatabase()
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
      </Stack>
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
