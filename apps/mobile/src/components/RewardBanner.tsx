import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '@/cart/CartProvider';
import { Icon } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { tierHighlight, usablePoints } from '@/loyalty/points';
import { takeReward, tierProducts, useRewardCatalog } from '@/loyalty/rewards';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.gift;

/**
 * Cadeau fidélité mis en avant à l'entrée du click & collect (lot 16, ADR 0021) :
 * « Tu as X points : une boisson offerte » → liste des produits du palier → le cadeau s'ajoute au
 * panier (offert), le client continue sa commande. Sans palier débloqué : ce qu'il manque.
 */
export function RewardBanner({ restaurantId }: { restaurantId: string }) {
  const { palette, radii } = useTenant();
  const insets = useSafeAreaInsets();
  const { program, member } = useLoyalty();
  const { cart, dispatch } = useCart();
  const catalog = useRewardCatalog({ restaurantId });
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!program?.enabled) return null;
  if (!member) {
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => router.navigate('/carte')}
        style={[styles.banner, { backgroundColor: palette.surface, borderRadius: radii.card }]}
      >
        <Icon name="gift" color={palette.accent} size={22} />
        <Text style={[styles.text, { color: palette.text }]}>{t.join(program.welcomePoints)}</Text>
      </Pressable>
    );
  }

  const points = usablePoints(member);
  const highlight = tierHighlight(program.rewards, points);
  if (!highlight) return null;
  const chosen = cart.reward ? catalog.products.get(cart.reward.productId) : undefined;

  if (highlight.kind === 'next') {
    return (
      <View
        style={[styles.banner, { backgroundColor: palette.surface, borderRadius: radii.card }]}
        accessibilityRole="text"
      >
        <Icon name="gift" color={palette.textMuted} size={22} />
        <View style={styles.body}>
          <Text style={[styles.text, { color: palette.text }]}>
            {t.next(highlight.missing, highlight.reward.name.toLowerCase())}
          </Text>
          <Text style={{ color: palette.textMuted, fontSize: 13 }}>{t.nextHint(points)}</Text>
        </View>
      </View>
    );
  }

  const reward = highlight.reward;
  const items = tierProducts(reward, catalog);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          chosen ? t.chosen(chosen.name) : t.unlocked(points, reward.name.toLowerCase())
        }
        onPress={() => setOpen(true)}
        style={[styles.banner, { backgroundColor: palette.loyalty, borderRadius: radii.card }]}
      >
        <Icon name="gift" color={palette.onLoyalty} size={24} />
        <View style={styles.body}>
          <Text style={[styles.text, { color: palette.onLoyalty }]}>
            {chosen ? t.chosen(chosen.name) : t.unlocked(points, reward.name.toLowerCase())}
          </Text>
          <Text style={{ color: palette.onLoyalty, opacity: 0.85, fontSize: 13 }}>
            {notice ?? t.unlockedHint}
          </Text>
        </View>
        <Text style={[styles.cta, { color: palette.onLoyalty }]}>
          {chosen ? t.change : t.choose} ›
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel={t.close}
          onPress={() => setOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: palette.background, paddingBottom: insets.bottom + 16 },
          ]}
          accessibilityViewIsModal
        >
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            {t.sheetTitle(reward.name)}
          </Text>
          {items.length === 0 ? (
            <Text style={{ color: palette.textMuted }}>{t.noProducts}</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.grid}>
              {items.map((p) => (
                <ProductCard
                  key={p.id}
                  width={156}
                  product={p}
                  accessibilityLabel={`${p.name}, ${t.offered}`}
                  footer={
                    <View
                      style={[
                        styles.offered,
                        { backgroundColor: palette.loyalty, borderRadius: radii.button },
                      ]}
                    >
                      <Text style={{ color: palette.onLoyalty, fontWeight: '800' }}>
                        {t.offered}
                      </Text>
                    </View>
                  }
                  onPress={() => {
                    setOpen(false);
                    setNotice(t.added(p.name));
                    takeReward({ rewardId: reward.id, product: p, restaurantId, cart, dispatch });
                  }}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  body: { flex: 1, gap: 2 },
  text: { fontWeight: '800', fontSize: 15 },
  cta: { fontWeight: '800', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    gap: 8,
  },
  handle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 19, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 8 },
  offered: { paddingVertical: 8, alignItems: 'center' },
});
