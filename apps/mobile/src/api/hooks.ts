import { menuSchema, restaurantListSchema } from '@splash360/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/tenant/TenantProvider';
import { apiGet } from './client';

export function useRestaurants() {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useQuery({
    queryKey: ['restaurants', sub],
    queryFn: () => apiGet(`/v1/tenants/${sub}/restaurants`, restaurantListSchema),
    select: (data) => data.restaurants,
  });
}

export function useMenu(restaurantId: string) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useQuery({
    queryKey: ['menu', sub, restaurantId],
    queryFn: () => apiGet(`/v1/tenants/${sub}/restaurants/${restaurantId}/menu`, menuSchema),
    staleTime: 60_000,
  });
}
