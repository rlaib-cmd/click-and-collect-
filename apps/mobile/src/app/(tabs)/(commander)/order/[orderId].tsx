import type { OrderTracking, PaymentSession } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import QRCode from 'react-native-qrcode-svg';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiRequestError } from '@/api/client';
import {
  useAvailability,
  useOrderTracking,
  usePaymentSession,
  usePosReadiness,
  useRegisterPushToken,
} from '@/api/hooks';
import { useCart } from '@/cart/CartProvider';
import { ErrorState, Loading, PrimaryButton, Screen } from '@/components/ui';
import { formatTime } from '@/lib/dates';
import { formatPrice } from '@/lib/format';
import { findSavedOrder } from '@/orders/storage';
import { PaymentForm } from '@/payments/PaymentForm';
import { titleStyle } from '@/components/brand';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { useTenant } from '@/tenant/TenantProvider';

const STEPS = {
  pickup: ['paid', 'accepted', 'preparing', 'ready', 'completed'],
  delivery: ['paid', 'accepted', 'preparing', 'out_for_delivery', 'completed'],
} as const;
type StepKey = keyof typeof messages.order.steps;

/** Paiement puis suivi de la commande (sections 4 et 5). */
export default function OrderScreen() {
  const { orderId, from } = useLocalSearchParams<{ orderId: string; from?: string }>();
  const { config, palette, style: brand } = useTenant();
  const { cart, dispatch } = useCart();
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const tracking = useOrderTracking(orderId, token ?? null);
  const availability = useAvailability(cart.restaurantId);
  const tz = availability.data?.timezone ?? 'Europe/Paris';
  const active =
    tracking.data !== undefined &&
    !['completed', 'cancelled', 'refunded'].includes(tracking.data.status);
  useRegisterPushToken(orderId, token ?? null, active);

  useEffect(() => {
    void findSavedOrder(config.tenant.subdomain, orderId).then((o) =>
      setToken(o?.accessToken ?? null),
    );
  }, [config.tenant.subdomain, orderId]);

  // La commande vient d'être passée : le panier peut être vidé (pas depuis l'historique).
  useEffect(() => {
    if (tracking.data && from !== 'history') dispatch({ type: 'clear' });
  }, [tracking.data, dispatch, from]);

  if (token === null)
    return <ErrorState message={messages.order.notFound} onRetry={() => router.replace('/')} />;
  if (tracking.isError)
    return (
      <ErrorState message={messages.tenant.networkError} onRetry={() => void tracking.refetch()} />
    );
  const order = tracking.data;
  if (token === undefined || !order) return <Loading />;
  const payable = order.status === 'pending_payment' || order.status === 'payment_failed';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: TAB_BAR_CLEARANCE + 24 },
        ]}
      >
        <Text
          style={[styles.title, titleStyle(brand), { color: palette.text }]}
          accessibilityRole="header"
        >
          {messages.order.title(order.number)}
        </Text>
        <Text style={[styles.status, { color: palette.accent }]} accessibilityLiveRegion="polite">
          {messages.order.status[order.status]}
        </Text>
        {!payable && order.status !== 'cancelled' ? (
          <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
            {order.scheduled
              ? messages.order.scheduledFor(formatTime(order.estimatedAt, tz))
              : messages.order.estimated(formatTime(order.estimatedAt, tz))}
          </Text>
        ) : null}

        {!payable &&
        !['completed', 'cancelled', 'refunded'].includes(order.status) &&
        order.pickupCode ? (
          <PickupCard order={order} />
        ) : null}

        {payable ? (
          <PaymentSection
            orderId={order.orderId}
            token={token}
            order={order}
            merchantName={config.tenant.name}
          />
        ) : null}
        {order.status === 'cancelled' ? (
          <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
            {messages.order.cancelledHelp}
          </Text>
        ) : null}
        {!payable && !['cancelled', 'refunded'].includes(order.status) ? (
          <Steps order={order} />
        ) : null}

        <View style={[styles.summary, { borderColor: palette.border }]}>
          {order.lines.map((l, i) => (
            <View key={i} style={styles.line}>
              <Text style={{ color: palette.text, flex: 1 }}>
                {l.quantity} × {l.name}
                {l.options.length > 0 ? (
                  <Text style={{ color: palette.textMuted }}>{` · ${l.options.join(', ')}`}</Text>
                ) : null}
              </Text>
              <Text style={{ color: palette.text }}>{formatPrice(l.totalCents)}</Text>
            </View>
          ))}
          <View style={styles.line}>
            <Text style={[styles.total, { color: palette.text }]}>{messages.checkout.total}</Text>
            <Text style={[styles.total, { color: palette.text }]}>
              {formatPrice(order.totals.totalCents)}
            </Text>
          </View>
        </View>

        {!payable ? (
          <PrimaryButton label={messages.order.backHome} onPress={() => router.replace('/')} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function PaymentSection({
  orderId,
  token,
  order,
  merchantName,
}: {
  orderId: string;
  token: string;
  order: OrderTracking;
  merchantName: string;
}) {
  const { palette } = useTenant();
  // La caisse doit d'abord accepter la commande : pas de paiement avant (ADR 0018).
  const readiness = usePosReadiness(orderId, token, true);
  const ready = readiness.data?.state === 'ready';
  const session = usePaymentSession(orderId, token);
  const [confirmed, setConfirmed] = useState(false);
  const { mutate } = session;

  useEffect(() => {
    if (ready) mutate();
  }, [ready, mutate]);

  if (readiness.data?.state === 'unavailable')
    return (
      <View style={styles.payment}>
        <Text style={{ color: palette.accent, textAlign: 'center' }} accessibilityRole="alert">
          {messages.payment.posUnavailable}
        </Text>
        <PrimaryButton label={messages.payment.backToMenu} onPress={() => router.replace('/')} />
      </View>
    );
  if (!ready)
    return (
      <View style={styles.payment} accessibilityLiveRegion="polite">
        <ActivityIndicator color={palette.primary} />
        <Text
          style={{ color: palette.text, textAlign: 'center', fontWeight: '700' }}
          accessibilityRole="text"
        >
          {messages.payment.posWaiting}
        </Text>
        <Text style={{ color: palette.textMuted, textAlign: 'center', fontSize: 13 }}>
          {messages.payment.posWaitingHint}
        </Text>
      </View>
    );
  if (confirmed)
    return (
      <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
        {messages.order.waitingConfirmation}
      </Text>
    );
  if (session.isError) {
    const unavailable =
      session.error instanceof ApiRequestError && session.error.code === 'payments_unavailable';
    return (
      <View style={styles.payment}>
        <Text style={{ color: palette.accent, textAlign: 'center' }} accessibilityRole="alert">
          {unavailable ? messages.payment.unavailable : messages.tenant.networkError}
        </Text>
        {!unavailable ? (
          <PrimaryButton label={messages.app.retry} onPress={() => mutate()} />
        ) : null}
      </View>
    );
  }
  if (!session.data) return <Loading />;
  const data: PaymentSession = session.data;
  return (
    <View style={styles.payment}>
      {order.status === 'payment_failed' ? (
        <Text style={{ color: palette.accent }} accessibilityRole="alert">
          {messages.payment.failed}
        </Text>
      ) : null}
      <PaymentForm
        session={data}
        merchantName={merchantName}
        onConfirmed={() => setConfirmed(true)}
      />
      <Text style={{ color: palette.textMuted, fontSize: 13, textAlign: 'center' }}>
        {messages.payment.secure}
      </Text>
    </View>
  );
}

/** QR code à présenter au comptoir ; montant à régler pour une commande à payer sur place. */
function PickupCard({ order }: { order: OrderTracking }) {
  const { palette, radii, style: brand } = useTenant();
  return (
    <View
      style={[styles.pickup, { backgroundColor: palette.primary, borderRadius: radii.card + 6 }]}
    >
      <Text style={[styles.pickupTitle, titleStyle(brand), { color: palette.onPrimary }]}>
        {messages.pay.qrTitle}
      </Text>
      <View
        style={styles.qrBox}
        accessible
        accessibilityLabel={messages.pay.code(order.pickupCode)}
      >
        <QRCode value={order.pickupCode} size={200} backgroundColor="#FFFFFF" color="#000000" />
      </View>
      <Text style={{ color: palette.onPrimary, fontWeight: '700' }} selectable>
        {order.pickupCode}
      </Text>
      {order.paymentMethod === 'on_site' ? (
        <Text style={[styles.toPay, titleStyle(brand), { color: palette.onPrimary }]}>
          {messages.pay.toPayOnSite(formatPrice(order.totals.totalCents))}
        </Text>
      ) : null}
      <Text style={{ color: palette.onPrimary, textAlign: 'center' }}>{messages.pay.qrHint}</Text>
    </View>
  );
}

function Steps({ order }: { order: OrderTracking }) {
  const { palette } = useTenant();
  const steps: readonly StepKey[] = STEPS[order.mode];
  // « Confirmée » (à payer sur place) occupe la première étape, comme « payée ».
  const current = steps.indexOf((order.status === 'confirmed' ? 'paid' : order.status) as StepKey);
  return (
    <View style={styles.steps} accessibilityRole="progressbar">
      {steps.map((s, i) => {
        const done = i <= current;
        return (
          <View key={s} style={styles.step}>
            <View
              style={[styles.dot, { backgroundColor: done ? palette.accent : palette.border }]}
            />
            <Text
              style={{
                color: done ? palette.text : palette.textMuted,
                fontWeight: i === current ? '700' : '400',
              }}
            >
              {messages.order.steps[s]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pickup: { alignItems: 'center', gap: 10, padding: 20 },
  pickupTitle: { fontSize: 20, fontWeight: '900' },
  qrBox: { backgroundColor: '#FFFFFF', padding: 12, borderRadius: 14 },
  toPay: { fontSize: 20, fontWeight: '900' },
  content: { padding: 24, gap: 14 },
  title: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  status: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  payment: { gap: 12, marginTop: 8 },
  steps: { gap: 10, marginTop: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 28 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  summary: { borderTopWidth: 1, paddingTop: 12, gap: 8, marginTop: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  total: { fontWeight: '700', fontSize: 17 },
});
