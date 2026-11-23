'use client';

import {
  loyaltyProgramSchema,
  menuSchema,
  restaurantListSchema,
  type TenantThemeDto,
} from '@splash360/contracts';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { API_URL } from './api';

export interface PreviewProduct {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCents: number;
  readonly imageUrl: string | null;
}

export interface PreviewTier {
  readonly name: string;
  readonly costPoints: number;
  readonly products: readonly PreviewProduct[];
}

/** Données réelles de l'enseigne affichées dans l'aperçu du studio design (lot 12). */
export interface PreviewData {
  readonly categories: readonly string[];
  readonly products: readonly PreviewProduct[];
  readonly tiers: readonly PreviewTier[];
  readonly pointsPerEuro: number;
}

export const EMPTY_PREVIEW: PreviewData = {
  categories: [],
  products: [],
  tiers: [],
  pointsPerEuro: 10,
};

async function publicGet<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T> | null> {
  try {
    const res = await fetch(`${API_URL}${path}`);
    if (!res.ok) return null;
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Charge la carte du premier restaurant et le programme de fidélité (API publique de l'application). */
export function usePreviewData(subdomain: string | null): PreviewData {
  const [data, setData] = useState<PreviewData>(EMPTY_PREVIEW);
  useEffect(() => {
    if (!subdomain) return;
    let cancelled = false;
    void (async () => {
      const base = `/v1/tenants/${encodeURIComponent(subdomain)}`;
      const list = await publicGet(`${base}/restaurants`, restaurantListSchema);
      const first = list?.restaurants[0];
      const menu = first
        ? await publicGet(`${base}/restaurants/${first.id}/menu`, menuSchema)
        : null;
      const program = await publicGet(`${base}/loyalty/program`, loyaltyProgramSchema);
      const products = (menu?.categories ?? []).flatMap((c) => c.products);
      const byId = new Map(products.map((p) => [p.id, p]));
      const tiers =
        program?.enabled === true
          ? program.rewards.map((r) => ({
              name: r.name,
              costPoints: r.costPoints,
              products: r.productIds.flatMap((id) => {
                const p = byId.get(id);
                return p ? [p] : [];
              }),
            }))
          : [];
      if (!cancelled)
        setData({
          categories: (menu?.categories ?? []).map((c) => c.name),
          products,
          tiers,
          pointsPerEuro: program?.enabled === true ? program.pointsPerEuro : 10,
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [subdomain]);
  return data;
}

export type { TenantThemeDto };
