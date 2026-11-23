import type { TenantConfig } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import {
  buildPalette,
  radiiFor,
  type Palette,
  type Radii,
  type ThemeStyle,
} from '@splash360/theme';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchTenantConfig, previewFromSearch, type TenantLoadError } from './api';
import { overrideFromSearch, resolveSubdomain } from './resolve';

interface TenantContextValue {
  readonly config: TenantConfig;
  readonly palette: Palette;
  readonly style: ThemeStyle;
  readonly radii: Radii;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function useTenant(): TenantContextValue {
  const value = useContext(TenantContext);
  if (!value) throw new Error('useTenant doit être utilisé sous <TenantProvider>');
  return value;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

const OVERRIDE_KEY = 'splash360:enseigne';
const PREVIEW_KEY = 'splash360:apercu';

/** Jeton d'aperçu du brouillon (web) : lu dans l'adresse, gardé pour l'onglet seulement. */
function currentPreviewToken(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const fromUrl = previewFromSearch(window.location.search);
    if (fromUrl) window.sessionStorage.setItem(PREVIEW_KEY, fromUrl);
    return fromUrl ?? window.sessionStorage.getItem(PREVIEW_KEY);
  } catch {
    return previewFromSearch(window.location.search);
  }
}

/** Mémorise ?enseigne= pour l'onglet : la navigation le retire de l'URL. */
function rememberOverride(search: string): string | null {
  try {
    const fromUrl = overrideFromSearch(search);
    if (fromUrl) window.sessionStorage.setItem(OVERRIDE_KEY, fromUrl);
    return fromUrl ?? window.sessionStorage.getItem(OVERRIDE_KEY);
  } catch {
    return null;
  }
}

function currentSubdomain(): string | null {
  const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
  const allowOverride = __DEV__ || process.env.EXPO_PUBLIC_ALLOW_TENANT_OVERRIDE === '1';
  return resolveSubdomain({
    platform: isWeb ? 'web' : 'native',
    buildTenant: process.env.EXPO_PUBLIC_TENANT,
    hostname: isWeb ? window.location.hostname : undefined,
    search: isWeb ? window.location.search : undefined,
    allowOverride,
    rememberedOverride: isWeb && allowOverride ? rememberOverride(window.location.search) : null,
  });
}

type State =
  | { status: 'loading' }
  | { status: 'error'; error: TenantLoadError | 'missing' }
  | { status: 'ready'; value: TenantContextValue };

/** Charge la configuration de l'enseigne avant d'afficher l'application (ADR 0004). */
export function TenantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [bannerOpen, setBannerOpen] = useState(true);

  const load = useCallback(async () => {
    const subdomain = currentSubdomain();
    if (!subdomain) {
      setState({ status: 'error', error: 'missing' });
      return;
    }
    setState({ status: 'loading' });
    const result = await fetchTenantConfig(API_URL, subdomain, fetch, currentPreviewToken());
    setState(
      result.ok
        ? {
            status: 'ready',
            value: {
              config: result.config,
              palette: buildPalette(result.config.theme),
              style: result.config.theme.style,
              radii: radiiFor(result.config.theme.style.corners),
            },
          }
        : { status: 'error', error: result.error },
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <View style={styles.center} accessibilityLabel={messages.app.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.status === 'error') {
    const text = {
      network: messages.tenant.networkError,
      not_found: messages.tenant.notFound,
      suspended: messages.tenant.suspended,
      missing: messages.tenant.missing,
    }[state.error];
    return (
      <View style={styles.center}>
        <Text style={styles.message} accessibilityRole="alert">
          {text}
        </Text>
        {state.error === 'network' ? (
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}>
            <Text style={styles.retryText}>{messages.app.retry}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <TenantContext.Provider value={state.value}>
      {state.value.config.preview ? (
        <View style={styles.previewRoot}>
          {bannerOpen ? (
            <View style={styles.previewBanner} accessibilityRole="alert">
              <Text style={styles.previewText}>{messages.tenant.previewBanner}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.tenant.previewClose}
                onPress={() => setBannerOpen(false)}
                style={styles.previewClose}
              >
                <Text style={styles.previewText}>✕</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.previewRoot}>{children}</View>
        </View>
      ) : (
        children
      )}
    </TenantContext.Provider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  message: { fontSize: 16, textAlign: 'center', color: '#111111' },
  retry: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#111111',
  },
  retryText: { color: '#FFFFFF', fontWeight: '600' },
  previewRoot: { flex: 1 },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#111111',
  },
  previewText: { color: '#FFD60A', fontWeight: '800', fontSize: 13 },
  previewClose: { minWidth: 44, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
});
