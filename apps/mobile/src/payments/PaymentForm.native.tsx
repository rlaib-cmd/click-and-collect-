import { messages } from '@splash360/i18n';
import { PaymentSheetError, StripeProvider, useStripe } from '@stripe/stripe-react-native';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/ui';
import { formatPrice } from '@/lib/format';
import { useTenant } from '@/tenant/TenantProvider';
import type { PaymentFormProps } from './types';

const MERCHANT_ID = 'merchant.fr.splash360.commande';

/**
 * Version iOS/Android : feuille de paiement Stripe (Apple Pay ou Google Pay en premier, puis carte).
 * Nécessite un build de développement EAS : ne fonctionne pas dans Expo Go.
 */
export function PaymentForm(props: PaymentFormProps) {
  return (
    <StripeProvider
      publishableKey={props.session.publishableKey}
      stripeAccountId={props.session.stripeAccountId}
      merchantIdentifier={MERCHANT_ID}
      urlScheme={Linking.createURL('/').split(':')[0] ?? 'splash360'}
    >
      <NativeSheet {...props} />
    </StripeProvider>
  );
}

function NativeSheet({ session, merchantName, onConfirmed }: PaymentFormProps) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const { palette } = useTenant();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initPaymentSheet({
      merchantDisplayName: merchantName,
      paymentIntentClientSecret: session.clientSecret,
      applePay: { merchantCountryCode: 'FR' },
      googlePay: {
        merchantCountryCode: 'FR',
        currencyCode: 'EUR',
        testEnv: session.publishableKey.startsWith('pk_test_'),
      },
      returnURL: Linking.createURL('stripe-redirect'),
      appearance: { colors: { primary: palette.primary } },
    }).then(({ error: e }) => {
      if (cancelled) return;
      if (e) setError(e.message);
      else setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initPaymentSheet, merchantName, palette.primary, session]);

  const pay = async () => {
    setError(null);
    const { error: e } = await presentPaymentSheet();
    if (!e) onConfirmed();
    else if (e.code !== PaymentSheetError.Canceled) setError(e.message);
  };

  return (
    <View style={styles.form}>
      {error ? (
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        label={messages.payment.pay(formatPrice(session.amountCents))}
        disabled={!ready}
        onPress={() => void pay()}
      />
    </View>
  );
}

const styles = StyleSheet.create({ form: { gap: 16 } });
