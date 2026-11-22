import { z } from 'zod';

const cents = z.number().int().nonnegative();

export const restaurantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  addressLine: z.string(),
  postalCode: z.string(),
  city: z.string(),
  /** paused = commande en ligne mise en pause par l'équipe. */
  status: z.enum(['active', 'paused']),
});

export const restaurantListSchema = z.object({ restaurants: z.array(restaurantSchema) });

export const menuOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceCents: cents,
  available: z.boolean(),
});

export const optionGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  required: z.boolean(),
  min: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  options: z.array(menuOptionSchema),
});

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: cents,
  imageUrl: z.string().nullable(),
  available: z.boolean(),
  allergens: z.array(z.string()),
  optionGroups: z.array(optionGroupSchema),
});

export const menuSchema = z.object({
  restaurantId: z.uuid(),
  /** Vrai si l'API menu Splash360 ne répond pas et que la dernière carte connue est servie. */
  stale: z.boolean(),
  fetchedAt: z.iso.datetime(),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      products: z.array(productSchema),
    }),
  ),
});

export type RestaurantDto = z.infer<typeof restaurantSchema>;
export type MenuDto = z.infer<typeof menuSchema>;
export type ProductDto = z.infer<typeof productSchema>;
export type OptionGroupDto = z.infer<typeof optionGroupSchema>;
