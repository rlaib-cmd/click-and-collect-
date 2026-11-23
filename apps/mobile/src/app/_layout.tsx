import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { CartProvider } from '@/cart/CartProvider';
import { LoyaltyProvider } from '@/loyalty/LoyaltyProvider';
import { TenantProvider, useTenant } from '@/tenant/TenantProvider';

function ThemedStack() {
  const { palette } = useTenant();
  return (
    <LoyaltyProvider>
      <CartProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.background },
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
        <StatusBar style={palette.mode === 'dark' ? 'light' : 'dark'} />
      </CartProvider>
    </LoyaltyProvider>
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
