import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { TenantProvider, useTenant } from '@/tenant/TenantProvider';

function ThemedStack() {
  const { palette } = useTenant();
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      />
      <StatusBar style={palette.mode === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  return (
    <TenantProvider>
      <ThemedStack />
    </TenantProvider>
  );
}
