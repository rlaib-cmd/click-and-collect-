import { formatFrenchPhone } from '@splash360/core';
import { customerSchema, type QuoteRequest } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiRequestError } from '@/api/client';
import { useAvailability, usePlaceOrder, useQuote } from '@/api/hooks';
import { giftAlone } from '@/cart/cart';
import { useCart } from '@/cart/CartProvider';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { Chip } from '@/components/Chip';
import { PaymentMethodCards } from '@/components/PaymentMethodCards';
import { SetupSummary } from '@/components/SetupSummary';
import { BackButton, ErrorState, Loading, PrimaryButton, Screen } from '@/components/ui';
import { firstMissing } from '@/lib/checkout';
import { formatPrice } from '@/lib/format';
import { listSavedPromos } from '@/orders/promos';
import { saveOrder } from '@/orders/storage';
import { titleStyle } from '@/components/brand';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { usablePoints } from '@/loyalty/points';
import { takeReward, tierProducts, useRewardCatalog } from '@/loyalty/rewards';
import { useTenant } from '@/tenant/TenantProvider';

const CONTACT_KEY = 'contact';
type Contact = { name: string; phone: string; email: string };

/** Récapitulatif : montants recalculés par le serveur, coordonnées, conditions de vente. */
export default function CheckoutScreen() {
  const { cart, dispatch } = useCart();
  const { palette, config, style: brand } = useTenant();
  const insets = useSafeAreaInsets();
  const [contact, setContact] = useState<Contact>({ name: '', phone: '', email: '' });
  const [marketing, setMarketing] = useState(false);
  const [terms, setTerms] = useState(false);
  // Une clé par tentative : un renvoi après coupure réseau ne crée pas de doublon.
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const place = usePlaceOrder();
  const loyalty = useLoyalty();
  // Cadeau choisi (palier + produit), retenu dans le panier : il peut venir de l'écran Avantages.
  const reward = cart.reward;
  // Cadeau seul au panier : il reste dans le panier, mais n'est pas demandé au devis et bloque la commande.
  const aloneGift = giftAlone(cart);
  // Code promo (lot 11) : contrôlé et calculé par le serveur au devis.
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoNotice, setPromoNotice] = useState<string | null>(null);
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
            loyalty: loyalty.memberToken
              ? {
                  memberToken: loyalty.memberToken,
                  rewardId: aloneGift ? null : (reward?.rewardId ?? null),
                  rewardProductId: aloneGift ? null : (reward?.productId ?? null),
                }
              : null,
            promoCode,
          },
    [cart, loyalty.memberToken, reward, aloneGift, promoCode],
  );
  const quote = useQuote(cart.restaurantId, request);
  // Récompense refusée par le serveur (points, produit retiré) : on la retire et on recalcule.
  const refusal =
    reward !== null && quote.error instanceof ApiRequestError
      ? quote.error.issues.find((i) =>
          [
            'insufficient_points',
            'reward_product_missing',
            'reward_product_not_eligible',
            'unknown_reward',
            'reward_needs_paid_items',
          ].includes(i.code),
        )?.code
      : undefined;
  const [rewardNotice, setRewardNotice] = useState<string | null>(null);
  // Code promo refusé : on le retire, on explique pourquoi et on recalcule sans lui.
  const promoRefusal =
    promoCode !== null && quote.error instanceof ApiRequestError
      ? quote.error.issues.find((i) => i.code.startsWith('promo_'))?.code
      : undefined;
  // Code promo refusé au moment de commander (désactivé entre-temps) : on le retire et on l'explique.
  const placePromoRefusal =
    place.error instanceof ApiRequestError
      ? place.error.issues.find((i) => i.code.startsWith('promo_'))?.code
      : undefined;
  useEffect(() => {
    if (!placePromoRefusal) return;
    setPromoCode(null);
    setPromoNotice(
      (messages.checkout.issue as Record<string, string>)[placePromoRefusal] ??
        messages.checkout.issue.other,
    );
  }, [placePromoRefusal]);
  useEffect(() => {
    if (!promoRefusal) return;
    setPromoCode(null);
    setPromoNotice(
      (messages.checkout.issue as Record<string, string>)[promoRefusal] ??
        messages.checkout.issue.other,
    );
  }, [promoRefusal]);
  useEffect(() => {
    if (!refusal) return;
    dispatch({ type: 'setReward', reward: null });
    setRewardNotice(
      (messages.checkout.issue as Record<string, string>)[refusal] ?? messages.checkout.issue.other,
    );
  }, [refusal, dispatch]);

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
    giftAlone: aloneGift,
  });
  const canPay = customer.success && terms && methodOk && !aloneGift && !place.isPending;
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
          // Points réservés par le cadeau : le solde affiché doit suivre tout de suite.
          loyalty.refresh();
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
          {q.totals.promoDiscountCents > 0 && q.promoCode ? (
            <Row
              label={messages.promo.line(q.promoCode)}
              value={`− ${formatPrice(q.totals.promoDiscountCents)}`}
            />
          ) : null}
          <Row label={messages.checkout.total} value={formatPrice(q.totals.totalCents)} strong />
        </View>

        <PromoField
          applied={q.promoCode}
          notice={promoNotice}
          onApply={(code) => {
            setPromoNotice(null);
            setPromoCode(code);
          }}
        />

        <Rewards
          onChange={() => setRewardNotice(null)}
          notice={rewardNotice}
          pointsEarned={q.loyalty?.pointsEarned ?? null}
          totalCents={q.totals.totalCents}
        />

        <View style={styles.section}>
          <Text style={[styles.h2, titleStyle(brand), { color: palette.text }]}>
            {messages.pay.choose}
          </Text>
          {payment.online || payment.onSite ? (
            <PaymentMethodCards
              online={payment.online}
              onSite={payment.onSite}
              onSiteLocked={loyalty.member === null}
              selected={method}
              onSelect={setChosenMethod}
            />
          ) : (
            <Text style={{ color: palette.accent }}>{messages.pay.onlineUnavailable}</Text>
          )}
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
              {placeErrorText(placeError)}
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

/**
 * Cadeaux au récapitulatif (lot 11) : chaque palier débloqué propose ses produits ; une touche
 * ajoute le produit offert au panier (ou ouvre sa fiche s'il a des choix). Points recontrôlés
 * par le serveur.
 */
function Rewards({
  onChange,
  notice,
  pointsEarned,
  totalCents,
}: {
  onChange: () => void;
  notice: string | null;
  pointsEarned: number | null;
  totalCents: number;
}) {
  const { palette, radii, style: brand } = useTenant();
  const { program, member } = useLoyalty();
  const { cart, dispatch } = useCart();
  const catalog = useRewardCatalog(cart);
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
  const usable = usablePoints(member);
  const selected = cart.reward;
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
      {[...program.rewards]
        .sort((x, y) => x.costPoints - y.costPoints)
        .map((r) => {
          const missing = Math.max(0, r.costPoints - usable);
          const unlocked = missing === 0;
          const tierOn = selected?.rewardId === r.id;
          return (
            <View
              key={r.id}
              style={[
                styles.reward,
                {
                  borderRadius: radii.card,
                  borderColor: unlocked ? palette.loyalty : palette.border,
                  borderWidth: unlocked ? 2 : 1,
                  backgroundColor: unlocked ? palette.background : 'transparent',
                  opacity: unlocked ? 1 : 0.5,
                },
              ]}
            >
              <Text style={{ color: palette.text, fontWeight: '800' }}>
                {messages.loyalty.tierTitle(r.costPoints)} · {r.name}
              </Text>
              {unlocked ? (
                <>
                  <Text style={{ color: palette.loyalty, fontSize: 12, fontWeight: '700' }}>
                    {messages.loyalty.giftPick}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.giftRow}>
                      {tierProducts(r, catalog.products).map((p) => {
                        const on = tierOn && selected?.productId === p.id;
                        return (
                          <Pressable
                            key={p.id}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: on }}
                            accessibilityLabel={`${p.name}${on ? `, ${messages.loyalty.giftOffered}` : ''}`}
                            onPress={() => {
                              onChange();
                              if (on) dispatch({ type: 'setReward', reward: null });
                              else
                                takeReward({
                                  rewardId: r.id,
                                  product: p,
                                  restaurantId: cart.restaurantId ?? catalog.restaurantId,
                                  cart,
                                  dispatch,
                                });
                            }}
                            style={[
                              styles.gift,
                              {
                                borderRadius: radii.button,
                                borderColor: palette.loyalty,
                                backgroundColor: on ? palette.loyalty : palette.background,
                              },
                            ]}
                          >
                            {p.imageUrl ? (
                              <Image
                                source={{ uri: p.imageUrl }}
                                style={styles.giftImage}
                                contentFit="contain"
                                accessibilityIgnoresInvertColors
                              />
                            ) : null}
                            <Text
                              style={{
                                color: on ? palette.onLoyalty : palette.text,
                                fontWeight: '700',
                              }}
                            >
                              {p.name}
                              {on ? ` ✓ ${messages.loyalty.giftOffered}` : ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>
                </>
              ) : (
                <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                  {messages.loyalty.rewardTooExpensive(missing)}
                </Text>
              )}
            </View>
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

/** Code promo avant paiement (lot 11) : saisie libre ou code gardé dans « Mes codes promo ». */
function PromoField({
  applied,
  notice,
  onApply,
}: {
  applied: string | null;
  notice: string | null;
  onApply: (code: string | null) => void;
}) {
  const { palette, radii, config, style: brand } = useTenant();
  const [input, setInput] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => {
    void listSavedPromos(config.tenant.subdomain).then(setSaved);
  }, [config.tenant.subdomain]);
  const t = messages.promo;
  return (
    <View style={styles.section}>
      <Text style={[styles.h2, titleStyle(brand), { color: palette.text }]}>{t.title}</Text>
      {applied ? (
        <View
          style={[
            styles.promoApplied,
            { backgroundColor: palette.surface, borderRadius: radii.card },
          ]}
        >
          <Text style={{ color: palette.text, fontWeight: '800', flex: 1 }}>
            {t.applied(applied)}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onApply(null)}
            style={styles.promoAction}
          >
            <Text style={{ color: palette.accent, fontWeight: '700' }}>{t.remove}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.promoRow}>
            <TextInput
              value={input}
              onChangeText={(v) => setInput(v.toUpperCase())}
              placeholder={t.placeholder}
              placeholderTextColor={palette.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel={t.title}
              style={[
                styles.input,
                styles.promoInput,
                { borderColor: palette.border, color: palette.text },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              disabled={input.trim().length < 3}
              onPress={() => onApply(input.trim())}
              style={[
                styles.promoButton,
                {
                  backgroundColor: palette.loyalty,
                  borderRadius: radii.button,
                  opacity: input.trim().length < 3 ? 0.5 : 1,
                },
              ]}
            >
              <Text style={{ color: palette.onLoyalty, fontWeight: '800' }}>{t.apply}</Text>
            </Pressable>
          </View>
          {saved.length > 0 ? (
            <View style={styles.promoChips}>
              {saved.map((code) => (
                <Chip key={code} label={code} selected={false} onPress={() => onApply(code)} />
              ))}
            </View>
          ) : null}
        </>
      )}
      {notice ? (
        <Text style={{ color: palette.accent, fontWeight: '600' }} accessibilityRole="alert">
          {notice}
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
  rewardsBox: { padding: 14, gap: 10 },
  rewardsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reward: { paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, gap: 6 },
  giftRow: { flexDirection: 'row', gap: 8 },
  promoRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  promoInput: { flex: 1, minWidth: 0, fontWeight: '700' },
  promoButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  promoApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    minHeight: 52,
  },
  promoAction: { minHeight: 44, justifyContent: 'center' },
  promoChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gift: {
    borderWidth: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
  },
  giftImage: { width: 36, height: 36 },
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

/** Message d'un refus de commande : créneau complet, problème précis du panier, ou réseau. */
function placeErrorText(error: ApiRequestError): string {
  if (error.code === 'slot_full') return messages.checkout.slotFull;
  const texts = messages.checkout.issue as Record<string, string>;
  const known = error.issues.map((i) => texts[i.code]).find((x): x is string => Boolean(x));
  if (known) return known;
  return error.code === 'order_invalid'
    ? messages.checkout.issue.other
    : messages.tenant.networkError;
}
