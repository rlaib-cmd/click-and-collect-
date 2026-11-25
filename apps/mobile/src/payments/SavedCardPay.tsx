import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/ui';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';
import { cardReturnUrl, completeCardAction } from './card-actions';
import { cardLabel, paySavedCard, useSavedCards } from './saved-cards';

const c = messages.cards;

/**
 * « Payer avec Visa •••• 4242 » (lot 18, ADR 0023) : proposé au membre connecté qui a enregistré
 * une carte. Le serveur confirme le paiement ; l'application ne termine que l'éventuelle
 * authentification 3-D Secure. La commande passe à « payée » par le webhook Stripe, comme ailleurs.
 */
export function SavedCardPay({
  orderId,
  orderToken,
  onConfirmed,
}: {
  orderId: string;
  orderToken: string;
  onConfirmed: () => void;
}) {
  const { palette, config } = useTenant();
  const { memberToken } = useLoyalty();
  const cards = useSavedCards();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!memberToken || !cards.data || cards.data.length === 0) return null;

  const pay = async (cardId: string) => {
    setBusy(cardId);
    setError(null);
    try {
      const result = await paySavedCard({
        sub: config.tenant.subdomain,
        orderId,
        orderToken,
        memberToken,
        cardId,
        returnUrl: cardReturnUrl(),
      });
      if (result.status === 'succeeded' || result.status === 'processing') onConfirmed();
      else if (result.status === 'requires_action') {
        const failure = await completeCardAction(result);
        if (failure) setError(failure);
        else onConfirmed();
      } else setError(c.declined);
    } catch {
      setError(c.error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.box}>
      {cards.data.map((card) => (
        <PrimaryButton
          key={card.id}
          label={busy === card.id ? c.paying : c.payWith(cardLabel(card))}
          disabled={busy !== null}
          onPress={() => void pay(card.id)}
        />
      ))}
      {error ? (
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: palette.border }]} />
        <Text style={{ color: palette.textMuted, fontSize: 13 }}>{c.otherMethod}</Text>
        <View style={[styles.line, { backgroundColor: palette.border }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: 1 },
});
