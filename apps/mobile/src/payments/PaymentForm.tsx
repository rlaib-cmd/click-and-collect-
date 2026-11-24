import { messages } from '@splash360/i18n';
import {
  Elements,
  ExpressCheckoutElement,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/ui';
import { formatPrice } from '@/lib/format';
import { useTenant } from '@/tenant/TenantProvider';
import type { PaymentFormProps } from './types';

const stripeCache = new Map<string, Promise<Stripe | null>>();

/** Version web : Stripe Payment Element (carte, Apple Pay et Google Pay selon le navigateur). */
export function PaymentForm({ session, onConfirmed }: PaymentFormProps) {
  const { palette } = useTenant();
  // Paiement direct : Stripe.js doit viser le compte du restaurant.
  const stripe = useMemo(() => {
    const cacheKey = `${session.publishableKey}:${session.stripeAccountId}`;
    let p = stripeCache.get(cacheKey);
    if (!p) {
      p = loadStripe(session.publishableKey, {
        stripeAccount: session.stripeAccountId,
        locale: 'fr',
      });
      stripeCache.set(cacheKey, p);
    }
    return p;
  }, [session.publishableKey, session.stripeAccountId]);

  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: session.clientSecret,
        locale: 'fr',
        appearance: {
          theme: palette.mode === 'dark' ? 'night' : 'stripe',
          variables: { colorPrimary: palette.accent, borderRadius: '10px' },
        },
      }}
    >
      <WebForm session={session} onConfirmed={onConfirmed} />
    </Elements>
  );
}

function WebForm({ session, onConfirmed }: Pick<PaymentFormProps, 'session' | 'onConfirmed'>) {
  const stripe = useStripe();
  const elements = useElements();
  const { palette } = useTenant();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Apple Pay / Google Pay proposés seulement si l'appareil et le navigateur les gèrent.
  const [wallets, setWallets] = useState(false);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: window.location.href },
    });
    setBusy(false);
    if (result.error) setError(result.error.message ?? messages.payment.failed);
    else onConfirmed();
  };

  return (
    <View style={styles.form}>
      <ExpressCheckoutElement
        options={{
          buttonHeight: 48,
          paymentMethods: { applePay: 'always', googlePay: 'always', link: 'never' },
        }}
        onReady={(e) => setWallets(Boolean(e.availablePaymentMethods))}
        onConfirm={() => void pay()}
      />
      {wallets ? (
        <View style={styles.divider}>
          <View style={[styles.line, { backgroundColor: palette.border }]} />
          <Text style={{ color: palette.textMuted, fontSize: 13 }}>{messages.payment.orCard}</Text>
          <View style={[styles.line, { backgroundColor: palette.border }]} />
        </View>
      ) : null}
      <PaymentElement options={{ wallets: { applePay: 'never', googlePay: 'never' } }} />
      {error ? (
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        label={
          busy
            ? messages.payment.processing
            : messages.payment.pay(formatPrice(session.amountCents))
        }
        disabled={!stripe || busy}
        onPress={() => void pay()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: 1 },
});
