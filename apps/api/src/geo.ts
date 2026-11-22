import type { AddressDto } from '@splash360/contracts';

export type GeoResult = Omit<AddressDto, 'instructions'>;

/** Suggestions d'adresse (accueil, livraison). */
export interface GeoProvider {
  search(query: string): Promise<GeoResult[]>;
}

interface GeoJsonResponse {
  features?: {
    geometry?: { coordinates?: [number, number] };
    properties?: { label?: string; name?: string; postcode?: string; city?: string };
  }[];
}

/**
 * Géocodeur de la Base Adresse Nationale (service public, gratuit).
 * URL configurable : `GEOCODER_URL` (format GeoJSON de l'API Adresse).
 */
export function createBanGeoProvider(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): GeoProvider {
  return {
    async search(query) {
      const url = new URL(baseUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '5');
      url.searchParams.set('type', 'housenumber');
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`Géocodeur : HTTP ${res.status}`);
      const body = (await res.json()) as GeoJsonResponse;
      return (body.features ?? []).flatMap((f) => {
        const p = f.properties;
        const [lon, lat] = f.geometry?.coordinates ?? [];
        if (!p?.label || !p.postcode || !p.city) return [];
        return [
          {
            label: p.label,
            postalCode: p.postcode,
            city: p.city,
            latitude: typeof lat === 'number' ? lat : null,
            longitude: typeof lon === 'number' ? lon : null,
          },
        ];
      });
    },
  };
}

/** Quelques adresses parisiennes, pour le développement hors ligne et les tests. */
const DEMO: GeoResult[] = [
  {
    label: '8 Boulevard Richard-Lenoir 75011 Paris',
    postalCode: '75011',
    city: 'Paris',
    latitude: 48.8565,
    longitude: 2.3707,
  },
  {
    label: '20 Rue de la Roquette 75011 Paris',
    postalCode: '75011',
    city: 'Paris',
    latitude: 48.8545,
    longitude: 2.3725,
  },
  {
    label: '5 Place de la Bastille 75012 Paris',
    postalCode: '75012',
    city: 'Paris',
    latitude: 48.8532,
    longitude: 2.3692,
  },
  {
    label: '1 Rue de Rivoli 75004 Paris',
    postalCode: '75004',
    city: 'Paris',
    latitude: 48.8556,
    longitude: 2.3601,
  },
  {
    label: '10 Avenue des Champs-Élysées 75008 Paris',
    postalCode: '75008',
    city: 'Paris',
    latitude: 48.8669,
    longitude: 2.3123,
  },
  {
    label: '1 Avenue de Paris 78000 Versailles',
    postalCode: '78000',
    city: 'Versailles',
    latitude: 48.8015,
    longitude: 2.1301,
  },
];

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function createDemoGeoProvider(): GeoProvider {
  return {
    search: (query) => {
      const words = normalize(query).split(/\s+/).filter(Boolean);
      return Promise.resolve(
        DEMO.filter((a) => words.every((w) => normalize(a.label).includes(w))).slice(0, 5),
      );
    },
  };
}
