import {
  availabilitySchema,
  deliveryCheckSchema,
  geoSearchSchema,
  menuSchema,
  orderTrackingSchema,
  paymentSessionSchema,
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
import { getPushToken } from '@/notifications/register';
import { API_URL, apiGet, apiPost, ApiRequestError } from './client';

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

const TERMINAL = new Set(['completed', 'cancelled', 'refunded']);

/** Suivi de commande : rafraîchi toutes les 4 s tant que la commande n'est pas terminée. */
export function useOrderTracking(orderId: string, accessToken: string | null) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useQuery({
    queryKey: ['order', sub, orderId],
    queryFn: () =>
      apiGet(`/v1/tenants/${sub}/orders/${orderId}`, orderTrackingSchema, (input, init) =>
        fetch(input, { ...init, headers: { Authorization: `Bearer ${accessToken ?? ''}` } }),
      ),
    enabled: accessToken !== null,
    refetchInterval: (query) =>
      query.state.data && TERMINAL.has(query.state.data.status) ? false : 4000,
  });
}

export function usePaymentSession(orderId: string, accessToken: string | null) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useMutation({
    mutationFn: () =>
      apiPost(
        `/v1/tenants/${sub}/orders/${orderId}/payment`,
        {},
        paymentSessionSchema,
        (input, init) =>
          fetch(input, {
            ...init,
            headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken ?? ''}` },
          }),
      ),
  });
}

/** Abonne l'appareil aux notifications de la commande (une fois par commande). */
export function useRegisterPushToken(
  orderId: string,
  accessToken: string | null,
  enabled: boolean,
) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  return useQuery({
    queryKey: ['push-token', sub, orderId],
    queryFn: async () => {
      const token = await getPushToken();
      if (!token) return false;
      const res = await fetch(`${API_URL}/v1/tenants/${sub}/orders/${orderId}/push-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken ?? ''}`,
        },
        body: JSON.stringify({ token }),
      });
      return res.ok;
    },
    enabled: enabled && accessToken !== null,
    staleTime: Infinity,
    retry: false,
  });
}
