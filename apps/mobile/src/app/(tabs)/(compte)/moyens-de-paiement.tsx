import type { CardSetup, SavedCard } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiRequestError } from '@/api/client';
import { titleStyle } from '@/components/brand';
import { Icon } from '@/components/icons';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { BackButton, ErrorState, Loading, PrimaryButton } from '@/components/ui';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { CardSetupForm } from '@/payments/CardSetupForm';
import { cardLabel, useCardActions, useSavedCards } from '@/payments/saved-cards';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.account;
const c = messages.cards;

/** Confirmation avant suppression : boîte native, ou confirm() sur le web. */
function confirmRemove(label: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(c.removeConfirm(label)));
  return new Promise((resolve) =>
    Alert.alert(c.removeConfirm(label), undefined, [
      { text: c.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: c.remove, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

/**
 * Mes moyens de paiement (lot 18, ADR 0023) : cartes enregistrées chez Stripe pour le membre
 * connecté. Aucune donnée de carte dans l'application : saisie dans le formulaire Stripe, puis
 * seuls la marque, les 4 derniers chiffres et l'expiration sont affichés.
 */
export default function PaymentMethodsScreen() {
  const { palette, style, radii, config } = useTenant();
  const insets = useSafeAreaInsets();
  const { memberToken } = useLoyalty();
  const cards = useSavedCards();
  const actions = useCardActions();
  const [setup, setSetup] = useState<CardSetup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startAdd = () => {
    setNotice(null);
    setError(null);
    actions.setup.mutate(undefined, {
      onSuccess: setSetup,
      onError: (e) =>
        setError(
          e instanceof ApiRequestError && e.code === 'payments_unavailable'
            ? c.unavailable
            : c.error,
        ),
    });
  };

  const remove = async (card: SavedCard) => {
    if (!(await confirmRemove(cardLabel(card)))) return;
    setError(null);
    actions.remove.mutate(card.id, { onError: () => setError(c.error) });
  };

  const box = { backgroundColor: palette.surface, borderRadius: radii.card + 4 };

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top + 8, paddingBottom: TAB_BAR_CLEARANCE + insets.bottom },
      ]}
    >
      <BackButton color={palette.accent} />
      <Text
        style={[styles.h1, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {t.payments}
      </Text>

      {memberToken === null ? (
        <View style={[styles.box, box]}>
          <View style={[styles.icon, { backgroundColor: palette.loyalty }]}>
            <Icon name="card" color={palette.onLoyalty} size={30} />
          </View>
          <Text style={{ color: palette.textMuted, textAlign: 'center', lineHeight: 20 }}>
            {c.loginNeeded}
          </Text>
        </View>
      ) : cards.isPending ? (
        <Loading />
      ) : cards.isError ? (
        <ErrorState message={c.error} onRetry={() => void cards.refetch()} />
      ) : (
        <>
          {cards.data.length === 0 ? (
            <View style={[styles.box, box]}>
              <View style={[styles.icon, { backgroundColor: palette.loyalty }]}>
                <Icon name="card" color={palette.onLoyalty} size={30} />
              </View>
              <Text style={[styles.title, { color: palette.text }]}>{c.empty}</Text>
              <Text style={{ color: palette.textMuted, textAlign: 'center', lineHeight: 20 }}>
                {c.emptyHint}
              </Text>
            </View>
          ) : (
            <View style={styles.list} accessibilityLabel={c.title}>
              {cards.data.map((card) => (
                <View key={card.id} style={[styles.card, box]}>
                  <Icon name="card" color={palette.accent} size={26} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.cardLabel, { color: palette.text }]}>
                      {cardLabel(card)}
                    </Text>
                    <Text style={{ color: palette.textMuted, fontSize: 13 }}>
                      {c.expires(card.expMonth, card.expYear)}
                    </Text>
                    <View style={styles.row}>
                      {card.isDefault ? (
                        <Text style={[styles.badge, { color: palette.accent }]}>{c.default}</Text>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() =>
                            actions.makeDefault.mutate(card.id, {
                              onError: () => setError(c.error),
                            })
                          }
                          hitSlop={8}
                        >
                          <Text style={[styles.link, { color: palette.accent }]}>
                            {c.makeDefault}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${c.remove} ${cardLabel(card)}`}
                        onPress={() => void remove(card)}
                        hitSlop={8}
                      >
                        <Text style={[styles.link, { color: palette.textMuted }]}>{c.remove}</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {notice ? (
            <Text style={{ color: palette.text, textAlign: 'center' }} accessibilityRole="alert">
              {notice}
            </Text>
          ) : null}
          {error ? (
            <Text style={{ color: palette.accent, textAlign: 'center' }} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          {setup ? (
            <View style={[styles.form, box]}>
              <CardSetupForm
                setup={setup}
                merchantName={config.tenant.name}
                onDone={() => {
                  setSetup(null);
                  setNotice(c.added);
                  void actions.refresh();
                }}
              />
              <Pressable accessibilityRole="button" onPress={() => setSetup(null)} hitSlop={8}>
                <Text style={[styles.link, { color: palette.textMuted, textAlign: 'center' }]}>
                  {c.cancel}
                </Text>
              </Pressable>
            </View>
          ) : (
            <PrimaryButton label={c.add} disabled={actions.setup.isPending} onPress={startAdd} />
          )}
          <Text style={{ color: palette.textMuted, fontSize: 12, textAlign: 'center' }}>
            {c.secure}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, gap: 16 },
  h1: { fontSize: 26, fontWeight: '900' },
  box: { alignItems: 'center', padding: 24, gap: 12 },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  list: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 16 },
  cardLabel: { fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 18, marginTop: 6 },
  badge: { fontSize: 13, fontWeight: '800' },
  link: { fontSize: 14, fontWeight: '700' },
  form: { padding: 16, gap: 12 },
});
