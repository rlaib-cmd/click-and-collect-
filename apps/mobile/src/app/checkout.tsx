import { customerSchema, type QuoteRequest } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiRequestError } from '@/api/client';
import { usePlaceOrder, useQuote } from '@/api/hooks';
import { useCart } from '@/cart/CartProvider';
import { SetupSummary } from '@/components/SetupSummary';
import { ErrorState, Loading, PrimaryButton, Screen } from '@/components/ui';
import { formatPrice } from '@/lib/format';
import { saveOrder } from '@/orders/storage';
import { titleStyle } from '@/components/brand';
import { useTenant } from '@/tenant/TenantProvider';

const CONTACT_KEY = 'contact';
type Contact = { name: string; phone: string; email: string };

/** Récapitulatif : montants recalculés par le serveur, coordonnées, conditions de vente. */
export default function CheckoutScreen() {
  const { cart } = useCart();
  const { palette, config, style: brand } = useTenant();
  const insets = useSafeAreaInsets();
  const [contact, setContact] = useState<Contact>({ name: '', phone: '', email: '' });
  const [marketing, setMarketing] = useState(false);
  const [terms, setTerms] = useState(false);
  // Une clé par tentative : un renvoi après coupure réseau ne crée pas de doublon.
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const place = usePlaceOrder();

  useEffect(() => {
    AsyncStorage.getItem(CONTACT_KEY)
      .then((raw) => {
        if (raw) setContact((c) => ({ ...c, ...(JSON.parse(raw) as Partial<Contact>) }));
      })
      .catch(() => undefined);
  }, []);

  const request: QuoteRequest | null = useMemo(
    () =>
      cart.lines.length === 0
        ? null
        : {
            mode: cart.setup.mode,
            address: cart.setup.mode === 'delivery' ? cart.setup.address : null,
            requestedTime: cart.setup.time,
            lines: cart.lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              optionIds: [...l.optionIds],
              note: l.note,
            })),
          },
    [cart],
  );
  const quote = useQuote(cart.restaurantId, request);

  if (!request || !cart.restaurantId)
    return <ErrorState message={messages.cart.empty} onRetry={() => router.replace('/')} />;
  if (quote.isPending) return <Loading />;
  if (quote.isError) {
    const err = quote.error;
    if (err instanceof ApiRequestError && err.code === 'order_invalid') {
      return <Issues codes={err.issues.map((i) => i.code)} />;
    }
    return (
      <ErrorState message={messages.tenant.networkError} onRetry={() => void quote.refetch()} />
    );
  }

  const q = quote.data;
  const customer = customerSchema.safeParse({ ...contact, marketingConsent: marketing });
  const canPay = customer.success && terms && !place.isPending;
  const placeError = place.error instanceof ApiRequestError ? place.error : null;

  const submit = () => {
    if (!customer.success || !cart.restaurantId) return;
    AsyncStorage.setItem(CONTACT_KEY, JSON.stringify(contact)).catch(() => undefined);
    place.mutate(
      {
        ...request,
        restaurantId: cart.restaurantId,
        customer: customer.data,
        idempotencyKey,
        acceptedTerms: true,
      },
      {
        onSuccess: async (order) => {
          await saveOrder(config.tenant.subdomain, {
            orderId: order.orderId,
            number: order.number,
            accessToken: order.accessToken,
            createdAt: new Date().toISOString(),
          }).catch(() => undefined);
          router.replace({ pathname: '/order/[orderId]', params: { orderId: order.orderId } });
        },
      },
    );
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={[styles.title, titleStyle(brand), { color: palette.text }]}
          accessibilityRole="header"
        >
          {messages.checkout.title}
        </Text>
        <SetupSummary />

        <View style={styles.section}>
          {q.lines.map((l, i) => (
            <View key={`${l.productId}-${i}`} style={styles.line}>
              <Text style={[styles.lineName, { color: palette.text }]}>
                {l.quantity} × {l.name}
                {l.options.length > 0 ? (
                  <Text
                    style={{ color: palette.textMuted }}
                  >{`\n${l.options.map((o) => o.name).join(', ')}`}</Text>
                ) : null}
              </Text>
              <Text style={{ color: palette.text }}>{formatPrice(l.totalCents)}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.section, styles.totals, { borderColor: palette.border }]}>
          <Row label={messages.cart.subtotal} value={formatPrice(q.totals.subtotalCents)} />
          {cart.setup.mode === 'delivery' ? (
            <Row
              label={messages.checkout.deliveryFee}
              value={
                q.totals.deliveryFeeCents === 0
                  ? messages.checkout.free
                  : formatPrice(q.totals.deliveryFeeCents)
              }
            />
          ) : null}
          {q.totals.serviceFeeCents > 0 ? (
            <Row
              label={messages.checkout.serviceFee}
              value={formatPrice(q.totals.serviceFeeCents)}
            />
          ) : null}
          <Row label={messages.checkout.total} value={formatPrice(q.totals.totalCents)} strong />
        </View>

        <View style={styles.section}>
          <Text style={[styles.h2, { color: palette.text }]}>{messages.checkout.contact}</Text>
          <Field
            label={messages.checkout.name}
            value={contact.name}
            onChange={(name) => setContact({ ...contact, name })}
            autoComplete="name"
          />
          <Field
            label={messages.checkout.phone}
            value={contact.phone}
            onChange={(phone) => setContact({ ...contact, phone })}
            autoComplete="tel"
            keyboard="phone-pad"
          />
          <Field
            label={messages.checkout.email}
            value={contact.email}
            onChange={(email) => setContact({ ...contact, email })}
            autoComplete="email"
            keyboard="email-address"
          />
          <Toggle label={messages.checkout.marketing} value={marketing} onChange={setMarketing} />
          <Toggle label={messages.checkout.terms} value={terms} onChange={setTerms} />
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/legal')}
            style={styles.link}
          >
            <Text style={{ color: palette.accent, textDecorationLine: 'underline' }}>
              {messages.checkout.readTerms}
            </Text>
          </Pressable>
          {placeError ? (
            <Text style={{ color: palette.accent }} accessibilityRole="alert">
              {placeError.code === 'slot_full'
                ? messages.checkout.slotFull
                : messages.tenant.networkError}
            </Text>
          ) : null}
        </View>
      </ScrollView>
      <View
        style={[styles.footer, { borderColor: palette.border, paddingBottom: 12 + insets.bottom }]}
      >
        <PrimaryButton
          label={messages.checkout.pay(formatPrice(q.totals.totalCents))}
          disabled={!canPay}
          onPress={submit}
        />
      </View>
    </Screen>
  );
}

function Issues({ codes }: { codes: readonly string[] }) {
  const { palette, style: brand } = useTenant();
  const texts = [
    ...new Set(
      codes.map(
        (c) =>
          (messages.checkout.issue as Record<string, string>)[c] ?? messages.checkout.issue.other,
      ),
    ),
  ];
  return (
    <Screen>
      <View style={styles.issues}>
        <Text
          style={[styles.title, titleStyle(brand), { color: palette.text }]}
          accessibilityRole="header"
        >
          {messages.checkout.issuesTitle}
        </Text>
        {texts.map((t) => (
          <Text key={t} style={{ color: palette.text, fontSize: 16 }} accessibilityRole="alert">
            • {t}
          </Text>
        ))}
        <PrimaryButton label={messages.checkout.backToCart} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const { palette } = useTenant();
  const style = [styles.rowText, { color: palette.text }, strong ? styles.strong : null];
  return (
    <View style={styles.row}>
      <Text style={style}>{label}</Text>
      <Text style={style}>{value}</Text>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'name' | 'tel' | 'email';
  keyboard?: 'phone-pad' | 'email-address';
}) {
  const { palette } = useTenant();
  return (
    <View style={styles.field}>
      <Text style={{ color: palette.textMuted }}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        autoComplete={props.autoComplete}
        keyboardType={props.keyboard ?? 'default'}
        autoCapitalize={props.autoComplete === 'name' ? 'words' : 'none'}
        accessibilityLabel={props.label}
        style={[styles.input, { borderColor: palette.border, color: palette.text }]}
      />
    </View>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { palette } = useTenant();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggle}
    >
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: palette.primary, false: palette.border }}
        thumbColor="#FFFFFF"
      />
      <Text style={{ color: palette.text, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { fontSize: 26, fontWeight: '700' },
  section: { gap: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineName: { flex: 1, fontSize: 16 },
  totals: { borderTopWidth: 1, paddingTop: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowText: { fontSize: 16 },
  strong: { fontSize: 18, fontWeight: '700' },
  h2: { fontSize: 18, fontWeight: '700', marginTop: 8 },
  field: { gap: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  link: { minHeight: 44, justifyContent: 'center' },
  issues: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
