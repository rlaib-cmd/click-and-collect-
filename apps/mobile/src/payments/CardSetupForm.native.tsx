import { messages } from '@splash360/i18n';
import { PaymentSheetError, StripeProvider, useStripe } from '@stripe/stripe-react-native';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';
import type { CardSetupFormProps } from './types';

/**
 * Version iOS/Android : ajout d'une carte avec la feuille Stripe (SetupIntent de la plateforme,
 * donc sans compte de restaurant). Nécessite un build de développement EAS.
 */
export function CardSetupForm(props: CardSetupFormProps) {
  return (
    <StripeProvider
      publishableKey={props.setup.publishableKey}
      urlScheme={Linking.createURL('/').split(':')[0] ?? 'splash360'}
    >
      <NativeSetup {...props} />
    </StripeProvider>
  );
}

function NativeSetup({ setup, merchantName, onDone }: CardSetupFormProps) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const { palette } = useTenant();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initPaymentSheet({
      merchantDisplayName: merchantName,
      setupIntentClientSecret: setup.clientSecret,
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
  }, [initPaymentSheet, merchantName, palette.primary, setup]);

  const save = async () => {
    setError(null);
    const { error: e } = await presentPaymentSheet();
    if (!e) onDone();
    else if (e.code !== PaymentSheetError.Canceled) setError(e.message);
  };

  return (
    <View style={styles.form}>
      <Text style={{ color: palette.textMuted, fontSize: 12 }}>{messages.cards.consent}</Text>
      {error ? (
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        label={messages.cards.enterCard}
        disabled={!ready}
        onPress={() => void save()}
      />
    </View>
  );
}

const styles = StyleSheet.create({ form: { gap: 14 } });
