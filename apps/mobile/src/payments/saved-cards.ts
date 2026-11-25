import {
  cardSetupSchema,
  savedCardPaymentSchema,
  savedCardsSchema,
  type SavedCardPayment,
} from '@splash360/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiSend } from '@/api/client';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { cardLabel, sortCards } from '@/lib/cards';
import { useTenant } from '@/tenant/TenantProvider';

export { cardLabel, sortCards };

/** Cartes enregistrées du membre connecté (lot 18) ; liste vide hors connexion. */
export function useSavedCards() {
  const { config } = useTenant();
  const { memberToken } = useLoyalty();
  const sub = config.tenant.subdomain;
  return useQuery({
    queryKey: ['saved-cards', sub, memberToken],
    queryFn: () =>
      apiGet(`/v1/tenants/${sub}/loyalty/me/cards`, savedCardsSchema, (input, init) =>
        fetch(input, { ...init, headers: { Authorization: `Bearer ${memberToken ?? ''}` } }),
      ),
    enabled: memberToken !== null,
    select: (d) => sortCards(d.cards),
  });
}

/** Ajout, suppression, carte par défaut : la liste est relue après chaque modification. */
export function useCardActions() {
  const { config } = useTenant();
  const { memberToken } = useLoyalty();
  const client = useQueryClient();
  const sub = config.tenant.subdomain;
  const auth = { Authorization: `Bearer ${memberToken ?? ''}` };
  const refresh = () => client.invalidateQueries({ queryKey: ['saved-cards', sub] });
  return {
    setup: useMutation({
      mutationFn: () =>
        apiSend('POST', `/v1/tenants/${sub}/loyalty/me/cards/setup`, cardSetupSchema, auth),
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        apiSend('DELETE', `/v1/tenants/${sub}/loyalty/me/cards/${id}`, z.null(), auth),
      onSettled: refresh,
    }),
    makeDefault: useMutation({
      mutationFn: (id: string) =>
        apiSend('POST', `/v1/tenants/${sub}/loyalty/me/cards/${id}/default`, z.null(), auth),
      onSettled: refresh,
    }),
    refresh,
  };
}

/** Paiement d'une commande avec une carte enregistrée (montant calculé par le serveur). */
export function paySavedCard(input: {
  sub: string;
  orderId: string;
  orderToken: string;
  memberToken: string;
  cardId: string;
  returnUrl?: string;
}): Promise<SavedCardPayment> {
  return apiSend(
    'POST',
    `/v1/tenants/${input.sub}/orders/${input.orderId}/payment/saved-card`,
    savedCardPaymentSchema,
    { Authorization: `Bearer ${input.orderToken}`, 'X-Member-Token': input.memberToken },
    { paymentMethodId: input.cardId, ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}) },
  );
}
