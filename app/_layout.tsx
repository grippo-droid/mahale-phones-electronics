import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';

export default function RootLayout() {
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
