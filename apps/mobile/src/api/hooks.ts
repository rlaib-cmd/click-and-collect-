import {
  availabilitySchema,
  deliveryCheckSchema,
  geoSearchSchema,
  menuSchema,
  placedOrderSchema,
  quoteSchema,
  restaurantListSchema,
  slotsSchema,
  type AddressDto,
  type PlaceOrderRequest,
  type QuoteRequest,
} from '@splash360/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTenant } from '@/tenant/TenantProvider';
import { apiGet, apiPost, ApiRequestError } from './client';

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

export function useAvailability(restaurantId: string | null) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useQuery({
    queryKey: ['availability', sub, restaurantId],
    queryFn: () =>
      apiGet(
        `/v1/tenants/${sub}/restaurants/${restaurantId ?? ''}/availability`,
        availabilitySchema,
      ),
    enabled: restaurantId !== null,
    refetchInterval: 60_000,
  });
}

export function useSlots(
  restaurantId: string | null,
  mode: 'pickup' | 'delivery',
  date: string | null,
) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useQuery({
    queryKey: ['slots', sub, restaurantId, mode, date],
    queryFn: () =>
      apiGet(
        `/v1/tenants/${sub}/restaurants/${restaurantId ?? ''}/slots?mode=${mode}&date=${date ?? ''}`,
        slotsSchema,
      ),
    enabled: restaurantId !== null && date !== null,
  });
}

export function useAddressSearch(query: string) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  const q = query.trim();
  return useQuery({
    queryKey: ['geo', sub, q],
    queryFn: () =>
      apiGet(`/v1/tenants/${sub}/geo/search?q=${encodeURIComponent(q)}`, geoSearchSchema),
    enabled: q.length >= 3,
    staleTime: 5 * 60_000,
    select: (d) => d.results,
  });
}

export function useDeliveryCheck(restaurantId: string | null, address: AddressDto | null) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useQuery({
    queryKey: ['delivery-check', sub, restaurantId, address?.label],
    queryFn: () =>
      apiPost(
        `/v1/tenants/${sub}/restaurants/${restaurantId ?? ''}/delivery-check`,
        address,
        deliveryCheckSchema,
      ),
    enabled: restaurantId !== null && address !== null,
  });
}

export function useQuote(restaurantId: string | null, request: QuoteRequest | null) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useQuery({
    queryKey: ['quote', sub, restaurantId, request],
    queryFn: () =>
      apiPost(`/v1/tenants/${sub}/restaurants/${restaurantId ?? ''}/quote`, request, quoteSchema),
    enabled: restaurantId !== null && request !== null,
    retry: (count, error) =>
      error instanceof ApiRequestError && error.code === 'network' && count < 2,
  });
}

export function usePlaceOrder() {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useMutation({
    mutationFn: (body: PlaceOrderRequest) =>
      apiPost(`/v1/tenants/${sub}/orders`, body, placedOrderSchema),
  });
}
