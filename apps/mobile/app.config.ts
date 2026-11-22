import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Configuration par enseigne (lot 7). `BRAND=<sous-domaine>` choisit `brands/<sous-domaine>.json` ;
 * sans BRAND, l'application Splash360 générique (développement, web multi-enseignes).
 */
interface Brand {
  name: string;
  subdomain: string | null;
  iosBundleIdentifier: string;
  androidPackage: string;
  scheme: string;
  primaryColor: string;
  appleMerchantId: string;
  icon?: string;
  splash?: string;
}

function loadBrand(id: string): Brand {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Marque invalide : ${id}`);
  const file = join(__dirname, 'brands', `${id}.json`);
  if (!existsSync(file)) throw new Error(`Marque inconnue : ${id} (fichier ${file} absent)`);
  const brand = JSON.parse(readFileSync(file, 'utf8')) as Brand;
  for (const key of [
    'name',
    'iosBundleIdentifier',
    'androidPackage',
    'scheme',
    'primaryColor',
    'appleMerchantId',
  ] as const) {
    if (!brand[key]) throw new Error(`Marque ${id} : champ « ${key} » manquant`);
  }
  return brand;
}

type Plugin = NonNullable<ExpoConfig['plugins']>[number];

export default ({ config }: ConfigContext): ExpoConfig => {
  const brand = loadBrand(process.env.BRAND ?? 'default');
  const plugins = (config.plugins ?? []).map((p: Plugin): Plugin => {
    const name = Array.isArray(p) ? p[0] : p;
    if (name === '@stripe/stripe-react-native') {
      return [
        '@stripe/stripe-react-native',
        { merchantIdentifier: brand.appleMerchantId, enableGooglePay: true },
      ];
    }
    if (name === 'expo-splash-screen' && Array.isArray(p)) {
      return [
        'expo-splash-screen',
        {
          ...(p[1] as object),
          backgroundColor: brand.primaryColor,
          ...(brand.splash ? { image: brand.splash } : {}),
        },
      ];
    }
    return p;
  });

  return {
    ...config,
    name: brand.name,
    slug: config.slug ?? 'claude-splash360',
    scheme: brand.scheme,
    ...(brand.icon ? { icon: brand.icon } : {}),
    ios: { ...config.ios, bundleIdentifier: brand.iosBundleIdentifier },
    android: {
      ...config.android,
      package: brand.androidPackage,
      adaptiveIcon: { ...config.android?.adaptiveIcon, backgroundColor: brand.primaryColor },
    },
    plugins,
    extra: {
      ...config.extra,
      brand: brand.subdomain,
      appleMerchantId: brand.appleMerchantId,
    },
  };
};
