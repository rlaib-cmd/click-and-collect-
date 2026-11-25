import { messages } from '@splash360/i18n';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';
import type { CardSetupFormProps } from './types';

const stripeCache = new Map<string, Promise<Stripe | null>>();

/**
 * Version web : ajout d'une carte (Stripe Payment Element, SetupIntent de la plateforme).
 * Le numéro de carte est saisi dans l'iframe Stripe : il ne passe jamais par l'application.
 */
export function CardSetupForm({ setup, onDone }: CardSetupFormProps) {
  const { palette } = useTenant();
  const stripe = useMemo(() => {
    let p = stripeCache.get(setup.publishableKey);
    if (!p) {
      p = loadStripe(setup.publishableKey, { locale: 'fr' });
      stripeCache.set(setup.publishableKey, p);
    }
    return p;
  }, [setup.publishableKey]);
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: setup.clientSecret,
        locale: 'fr',
        appearance: {
          theme: palette.mode === 'dark' ? 'night' : 'stripe',
          variables: { colorPrimary: palette.accent, borderRadius: '10px' },
        },
      }}
    >
      <WebSetup onDone={onDone} />
    </Elements>
  );
}

function WebSetup({ onDone }: Pick<CardSetupFormProps, 'onDone'>) {
  const stripe = useStripe();
  const elements = useElements();
  const { palette } = useTenant();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const result = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: window.location.href },
    });
    setBusy(false);
    if (result.error) setError(result.error.message ?? messages.cards.addFailed);
    else onDone();
  };

  return (
    <View style={styles.form}>
      <PaymentElement
        options={{ wallets: { applePay: 'never', googlePay: 'never' }, terms: { card: 'never' } }}
      />
      <Text style={{ color: palette.textMuted, fontSize: 12 }}>{messages.cards.consent}</Text>
      {error ? (
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        label={busy ? messages.cards.saving : messages.cards.save}
        disabled={!stripe || busy}
        onPress={() => void save()}
      />
    </View>
  );
}

const styles = StyleSheet.create({ form: { gap: 14 } });
