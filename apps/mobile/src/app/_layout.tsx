import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { CartProvider } from '@/cart/CartProvider';
import { TenantProvider, useTenant } from '@/tenant/TenantProvider';

function ThemedStack() {
  const { palette } = useTenant();
  return (
    <CartProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="r/[restaurantId]/p/[productId]" options={{ presentation: 'modal' }} />
      </Stack>
      <StatusBar style={palette.mode === 'dark' ? 'light' : 'dark'} />
    </CartProvider>
  );
}

export default function RootLayout() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 30_000 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <TenantProvider>
        <ThemedStack />
      </TenantProvider>
    </QueryClientProvider>
  );
}
