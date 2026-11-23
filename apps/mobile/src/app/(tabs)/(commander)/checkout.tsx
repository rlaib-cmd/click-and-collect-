import { formatFrenchPhone } from '@splash360/core';
import { customerSchema, type QuoteRequest } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiRequestError } from '@/api/client';
import { useAvailability, useMenu, usePlaceOrder, useQuote } from '@/api/hooks';
import { useCart } from '@/cart/CartProvider';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { Chip } from '@/components/Chip';
import { SetupSummary } from '@/components/SetupSummary';
import { BackButton, ErrorState, Loading, PrimaryButton, Screen } from '@/components/ui';
import { firstMissing } from '@/lib/checkout';
import { formatPrice } from '@/lib/format';
import { saveOrder } from '@/orders/storage';
import { titleStyle } from '@/components/brand';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { usablePoints } from '@/loyalty/points';
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
  const loyalty = useLoyalty();
  const [rewardId, setRewardId] = useState<string | null>(null);
  // Moyen de paiement (ADR 0010) : en ligne par défaut, sur place si le restaurant n'encaisse pas en ligne.
  const availability = useAvailability(cart.restaurantId);
  const [chosenMethod, setChosenMethod] = useState<'online' | 'on_site' | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CONTACT_KEY)
      .then((raw) => {
        if (raw) setContact((c) => ({ ...c, ...(JSON.parse(raw) as Partial<Contact>) }));
      })
      .catch(() => undefined);
  }, []);
  // Membre du club : nom et e-mail préremplis.
  useEffect(() => {
    const m = loyalty.member;
    if (m)
      setContact((c) => ({
        ...c,
        name: c.name || m.name,
        email: c.email || (m.email ?? ''),
        phone: c.phone || (m.phone ? formatFrenchPhone(m.phone) : ''),
      }));
  }, [loyalty.member]);

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
            loyalty: loyalty.memberToken ? { memberToken: loyalty.memberToken, rewardId } : null,
          },
    [cart, loyalty.memberToken, rewardId],
  );
  const quote = useQuote(cart.restaurantId, request);
  // Récompense refusée par le serveur (points, produit retiré) : on la retire et on recalcule.
  const refusal =
    rewardId !== null && quote.error instanceof ApiRequestError
      ? quote.error.issues.find((i) =>
          [
            'insufficient_points',
            'reward_product_missing',
            'unknown_reward',
            'reward_needs_paid_items',
          ].includes(i.code),
        )?.code
      : undefined;
  const [rewardNotice, setRewardNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!refusal) return;
    setRewardId(null);
    setRewardNotice(
      (messages.checkout.issue as Record<string, string>)[refusal] ?? messages.checkout.issue.other,
    );
  }, [refusal]);

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
  const payment = availability.data?.payment ?? { online: true, onSite: false };
  const method = chosenMethod ?? (!payment.online && payment.onSite ? 'on_site' : 'online');
  const methodOk = method === 'online' ? payment.online : payment.onSite && loyalty.member !== null;
  const customer = customerSchema.safeParse({ ...contact, marketingConsent: marketing });
  const missing = firstMissing({
    contact,
    terms,
    needsMember: method === 'on_site' && loyalty.member === null,
  });
  const canPay = customer.success && terms && methodOk && !place.isPending;
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
        paymentMethod: method,
      },
      {
        onSuccess: async (order) => {
          await saveOrder(config.tenant.subdomain, {
            orderId: order.orderId,
            number: order.number,
            accessToken: order.accessToken,
            createdAt: new Date().toISOString(),
            cart: JSON.stringify(cart),
            summary: q.lines.map((l) => `${l.quantity} × ${l.name}`).join(', '),
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
        <BackButton />
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
          {q.totals.discountCents > 0 ? (
            <Row
              label={messages.loyalty.discount}
              value={`− ${formatPrice(q.totals.discountCents)}`}
            />
          ) : null}
          <Row label={messages.checkout.total} value={formatPrice(q.totals.totalCents)} strong />
        </View>

        <Rewards
          selected={rewardId}
          onSelect={(id) => {
            setRewardNotice(null);
            setRewardId(id);
          }}
          notice={rewardNotice}
          pointsEarned={q.loyalty?.pointsEarned ?? null}
          totalCents={q.totals.totalCents}
        />

        {payment.onSite || !payment.online ? (
          <View style={styles.section}>
            <Text style={[styles.h2, titleStyle(brand), { color: palette.text }]}>
              {messages.pay.choose}
            </Text>
            <View style={styles.methods}>
              {(['online', 'on_site'] as const)
                .filter((m) => (m === 'online' ? payment.online : payment.onSite))
                .map((m) => (
                  <Chip
                    key={m}
                    label={m === 'online' ? messages.pay.online : messages.pay.onSite}
                    selected={method === m}
                    onPress={() => setChosenMethod(m)}
                  />
                ))}
            </View>
            {method === 'on_site' ? (
              <Text style={{ color: palette.textMuted }}>{messages.pay.onSiteHint}</Text>
            ) : null}
            {method === 'on_site' && !loyalty.member ? (
              <Pressable accessibilityRole="link" onPress={() => router.navigate('/carte')}>
                <Text style={{ color: palette.accent, fontWeight: '700' }}>
                  {messages.pay.onSiteMembersOnly} →
                </Text>
              </Pressable>
            ) : null}
            {!payment.online && !payment.onSite ? (
              <Text style={{ color: palette.accent }}>{messages.pay.onlineUnavailable}</Text>
            ) : null}
          </View>
        ) : null}

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
            hint={messages.checkout.emailHint}
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
        style={[styles.footer, { borderColor: palette.border, paddingBottom: TAB_BAR_CLEARANCE }]}
      >
        {missing ? (
          <Text
            style={[styles.missing, { color: palette.textMuted }]}
            accessibilityLiveRegion="polite"
          >
            {messages.checkout.missing[missing]}
          </Text>
        ) : null}
        <PrimaryButton
          label={
            method === 'on_site'
              ? messages.pay.placeOnSite(formatPrice(q.totals.totalCents))
              : messages.checkout.pay(formatPrice(q.totals.totalCents))
          }
          disabled={!canPay}
          onPress={submit}
        />
      </View>
    </Screen>
  );
}

/** Récompenses utilisables : produit présent dans le panier et solde suffisant (recontrôlé par le serveur). */
function Rewards({
  selected,
  onSelect,
  notice,
  pointsEarned,
  totalCents,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  notice: string | null;
  pointsEarned: number | null;
  totalCents: number;
}) {
  const { palette, radii, style: brand } = useTenant();
  const { program, member } = useLoyalty();
  const { cart, dispatch } = useCart();
  const menu = useMenu(cart.restaurantId ?? '');
  if (!program?.enabled) return null;
  if (!member) {
    const estimate = Math.floor((totalCents * program.pointsPerEuro) / 100);
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => router.navigate('/carte')}
        style={[
          styles.section,
          styles.rewardsBox,
          { backgroundColor: palette.surface, borderRadius: radii.card },
        ]}
      >
        <Text style={{ color: palette.text, fontWeight: '700' }}>
          {messages.loyalty.joinToEarn(estimate)}
        </Text>
        <Text style={{ color: palette.accent, fontWeight: '700' }}>{messages.loyalty.join} →</Text>
      </Pressable>
    );
  }
  const inCart = new Set(cart.lines.map((l) => l.productId));
  const products = new Map(
    (menu.data?.categories ?? []).flatMap((c) => c.products.map((p) => [p.id, p] as const)),
  );
  /** Cadeau débloqué absent du panier : on l'ajoute d'un geste (ou on ouvre le produit s'il a des choix). */
  const take = (rewardId: string, productId: string) => {
    const product = products.get(productId);
    if (!cart.restaurantId) return;
    const needsChoice = product?.optionGroups.some((g) => g.required || g.min > 0) ?? true;
    if (!product || needsChoice) {
      router.navigate(`/r/${cart.restaurantId}/p/${productId}`);
      return;
    }
    dispatch({
      type: 'add',
      restaurantId: cart.restaurantId,
      productId,
      quantity: 1,
      optionIds: [],
      note: null,
    });
    onSelect(rewardId);
  };
  return (
    <View
      style={[
        styles.section,
        styles.rewardsBox,
        { backgroundColor: palette.surface, borderRadius: radii.card },
      ]}
    >
      <View style={styles.rewardsHead}>
        <Text style={[styles.h2, titleStyle(brand), { color: palette.text }]}>
          {messages.loyalty.useReward}
        </Text>
        <Text style={{ color: palette.text, fontWeight: '700' }}>
          {messages.loyalty.points(member.points)}
        </Text>
      </View>
      {member.reservedPoints > 0 ? (
        <Text style={{ color: palette.textMuted, fontSize: 13 }}>
          {messages.loyalty.reserved(member.reservedPoints)}
        </Text>
      ) : null}
      {program.rewards.map((r) => {
        const missing = Math.max(0, r.costPoints - usablePoints(member));
        const unlocked = missing === 0;
        const present = inCart.has(r.productId);
        const on = selected === r.id;
        // Débloqué : couleur du club ; appliqué : plein ; pas encore atteint : grisé.
        const bg = on ? palette.loyalty : unlocked ? palette.background : 'transparent';
        const fg = on ? palette.onLoyalty : palette.text;
        return (
          <Pressable
            key={r.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: !unlocked }}
            disabled={!unlocked}
            onPress={() =>
              on ? onSelect(null) : present ? onSelect(r.id) : take(r.id, r.productId)
            }
            style={[
              styles.reward,
              {
                borderRadius: radii.button,
                borderColor: unlocked ? palette.loyalty : palette.border,
                borderWidth: unlocked ? 2 : 1,
                backgroundColor: bg,
                opacity: unlocked ? 1 : 0.5,
              },
            ]}
          >
            <Text style={{ color: fg, fontWeight: '700' }}>
              {r.name} · {messages.loyalty.points(r.costPoints)}
              {on ? ` ✓ ${messages.loyalty.rewardApplied}` : ''}
            </Text>
            {on ? null : unlocked ? (
              <Text style={{ color: palette.loyalty, fontSize: 12, fontWeight: '800' }}>
                {present ? messages.loyalty.rewardTap : messages.loyalty.rewardTapAdd(r.name)}
              </Text>
            ) : (
              <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                {messages.loyalty.rewardTooExpensive(missing)}
              </Text>
            )}
          </Pressable>
        );
      })}
      {notice ? (
        <Text style={{ color: palette.accent, fontWeight: '600' }} accessibilityRole="alert">
          {notice}
        </Text>
      ) : null}
      {pointsEarned !== null ? (
        <Text style={{ color: palette.text, fontWeight: '600' }}>
          {messages.loyalty.willEarn(pointsEarned)}
        </Text>
      ) : null}
    </View>
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
  hint?: string;
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
        accessibilityHint={props.hint}
        style={[styles.input, { borderColor: palette.border, color: palette.text }]}
      />
      {props.hint ? (
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>{props.hint}</Text>
      ) : null}
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
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rewardsBox: { padding: 14, gap: 10 },
  rewardsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reward: { borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, gap: 2 },
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
  missing: { textAlign: 'center', fontSize: 13, marginBottom: 8 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
