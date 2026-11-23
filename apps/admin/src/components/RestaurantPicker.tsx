'use client';

import { adminRestaurantSchema, type AdminRestaurant } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useEffect } from 'react';
import { z } from 'zod';
import { useApi } from '@/lib/use-api';

export const restaurantsSchema = z.object({
  restaurants: z.array(adminRestaurantSchema),
  /** Identifiants Splash360 posés sur le serveur (ADR 0018). */
  splash360Configured: z.boolean().default(false),
});

/** Choix du restaurant (masqué s'il n'y en a qu'un). */
export function RestaurantPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (r: AdminRestaurant) => void;
}) {
  const { data } = useApi('/restaurants', restaurantsSchema);
  const list = data?.restaurants ?? [];
  useEffect(() => {
    const first = list[0];
    if (!value && first) onChange(first);
  }, [list, value, onChange]);
  if (list.length <= 1) return null;
  return (
    <label className="inline">
      {messages.admin.common.restaurant}
      <select
        value={value ?? ''}
        onChange={(e) => {
          const r = list.find((x) => x.id === e.target.value);
          if (r) onChange(r);
        }}
      >
        {list.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
