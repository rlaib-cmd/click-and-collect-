import type { OptionGroupDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMenu } from '@/api/hooks';
import { useCart } from '@/cart/CartProvider';
import { ErrorState, Loading, PrimaryButton, Screen } from '@/components/ui';
import { formatPrice, formatSupplement } from '@/lib/format';
import { findProduct } from '@/menu/display';
import {
  activeGroups,
  displayUnitPrice,
  emptySelection,
  missingGroups,
  optionCount,
  selectedOptionIds,
  stepOption,
  toggleOption,
  type Selection,
} from '@/menu/selection';
import { titleStyle } from '@/components/brand';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { useTenant } from '@/tenant/TenantProvider';

function groupHint(g: OptionGroupDto): string {
  const base =
    g.min === 1 && g.max === 1
      ? messages.product.chooseOne
      : g.min > 0
        ? messages.product.chooseBetween(g.min, g.max)
        : messages.product.upTo(g.max);
  return g.maxPerOption > 1 ? `${base} · ${messages.product.perOptionHint(g.maxPerOption)}` : base;
}

export default function ProductScreen() {
  const { restaurantId, productId, reward } = useLocalSearchParams<{
    restaurantId: string;
    productId: string;
    /** Mode cadeau (lot 11) : palier dont ce produit est offert. */
    reward?: string;
  }>();
  const { palette, style: brand } = useTenant();
  const { dispatch } = useCart();
  const insets = useSafeAreaInsets();
  const menu = useMenu(restaurantId);
  const product = useMemo(
    () => (menu.data ? findProduct(menu.data, productId) : null),
    [menu.data, productId],
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  if (menu.isPending) return <Loading />;
  if (menu.isError)
    return <ErrorState message={messages.menu.menuError} onRetry={() => void menu.refetch()} />;
  if (!product || !product.available)
    return <ErrorState message={messages.product.notFound} onRetry={() => router.back()} />;

  const current = selection ?? emptySelection(product);
  const missing = missingGroups(product, current);
  const total = displayUnitPrice(product, current) * quantity;

  const add = () => {
    dispatch({
      type: 'add',
      restaurantId,
      productId: product.id,
      quantity,
      optionIds: selectedOptionIds(product, current),
      note: note.trim() || null,
    });
    if (reward) {
      dispatch({ type: 'setReward', reward: { rewardId: reward, productId: product.id } });
      router.navigate('/cart');
      return;
    }
    router.back();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.close}
          hitSlop={8}
        >
          <Text style={[styles.closeText, { color: palette.accent }]}>
            {messages.product.close}
          </Text>
        </Pressable>
        {product.imageUrl ? (
          <View style={[styles.photoBox, { borderRadius: 20 }]}>
            <Image
              source={{ uri: product.imageUrl }}
              style={styles.photo}
              contentFit="contain"
              accessibilityIgnoresInvertColors
            />
          </View>
        ) : null}
        <Text
          style={[styles.title, titleStyle(brand), { color: palette.text }]}
          accessibilityRole="header"
        >
          {product.name}
        </Text>
        {product.description ? (
          <Text style={{ color: palette.textMuted, fontSize: 16 }}>{product.description}</Text>
        ) : null}
        <Text style={[styles.base, { color: palette.text }]}>
          {formatPrice(product.priceCents)}
        </Text>
        {reward ? (
          <Text
            style={[
              styles.giftBanner,
              { backgroundColor: palette.loyalty, color: palette.onLoyalty },
            ]}
            accessibilityRole="alert"
          >
            {messages.loyalty.giftBanner}
          </Text>
        ) : null}

        {activeGroups(product, current).map((group) => {
          const chosen = current[group.id] ?? [];
          // Même option plusieurs fois (`max_par_produit` Splash360) : un compteur par option.
          const stepper = group.maxPerOption > 1;
          return (
            <View
              key={group.id}
              style={[styles.group, group.parentOptionId ? styles.nested : null]}
              accessibilityRole={stepper ? undefined : 'radiogroup'}
            >
              <View style={styles.groupHead}>
                <Text style={[styles.groupTitle, { color: palette.text }]}>{group.name}</Text>
                <Text
                  style={[
                    styles.badge,
                    {
                      backgroundColor: group.required ? palette.primary : palette.surface,
                      color: group.required ? palette.onPrimary : palette.textMuted,
                    },
                  ]}
                >
                  {group.required ? messages.product.required : messages.product.optional}
                </Text>
              </View>
              <Text style={{ color: palette.textMuted }}>{groupHint(group)}</Text>
              {group.options.map((option) => {
                if (stepper) {
                  const n = optionCount(current, group, option.id);
                  return (
                    <View
                      key={option.id}
                      style={[
                        styles.option,
                        { borderColor: palette.border, opacity: option.available ? 1 : 0.45 },
                      ]}
                      accessibilityLabel={messages.product.optionQuantity(option.name, n)}
                    >
                      <Text style={[styles.optionName, { color: palette.text }]}>
                        {option.name}
                      </Text>
                      <Text style={{ color: palette.textMuted }}>
                        {option.available
                          ? (formatSupplement(option.priceCents) ?? '')
                          : messages.menu.unavailable}
                      </Text>
                      {option.available ? (
                        <>
                          <StepButton
                            label="−"
                            a11y={messages.product.decreaseOption(option.name)}
                            onPress={() =>
                              setSelection(stepOption(current, group, option.id, -1, product))
                            }
                          />
                          <Text style={[styles.qty, { color: palette.text }]}>{n}</Text>
                          <StepButton
                            label="+"
                            a11y={messages.product.increaseOption(option.name)}
                            onPress={() =>
                              setSelection(stepOption(current, group, option.id, 1, product))
                            }
                          />
                        </>
                      ) : null}
                    </View>
                  );
                }
                const checked = chosen.includes(option.id);
                const single = group.max === 1;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole={single ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked, disabled: !option.available }}
                    disabled={!option.available}
                    onPress={() => setSelection(toggleOption(current, group, option.id, product))}
                    style={[
                      styles.option,
                      { borderColor: palette.border, opacity: option.available ? 1 : 0.45 },
                    ]}
                  >
                    <View
                      style={[
                        single ? styles.radio : styles.checkbox,
                        {
                          borderColor: checked ? palette.accent : palette.textMuted,
                          backgroundColor: checked ? palette.accent : 'transparent',
                        },
                      ]}
                    />
                    <Text style={[styles.optionName, { color: palette.text }]}>{option.name}</Text>
                    <Text style={{ color: palette.textMuted }}>
                      {option.available
                        ? (formatSupplement(option.priceCents) ?? '')
                        : messages.menu.unavailable}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}

        <View style={styles.group}>
          <Text style={[styles.groupTitle, { color: palette.text }]}>
            {messages.product.instructions}
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={200}
            placeholder={messages.product.instructionsPlaceholder}
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { borderColor: palette.border, color: palette.text }]}
            multiline
          />
        </View>

        <View style={styles.group}>
          <Text style={[styles.groupTitle, { color: palette.text }]}>
            {messages.product.allergens}
          </Text>
          <Text style={{ color: palette.textMuted }}>
            {product.allergens.length > 0
              ? product.allergens.join(', ')
              : messages.product.noAllergens}
          </Text>
        </View>
      </ScrollView>

      <View
        style={[styles.footer, { borderColor: palette.border, paddingBottom: TAB_BAR_CLEARANCE }]}
      >
        <View style={styles.stepper} accessibilityLabel={messages.product.quantity(quantity)}>
          <StepButton
            label="−"
            a11y={messages.product.decrease}
            onPress={() => setQuantity((q) => Math.max(1, q - 1))}
          />
          <Text style={[styles.qty, { color: palette.text }]}>{quantity}</Text>
          <StepButton
            label="+"
            a11y={messages.product.increase}
            onPress={() => setQuantity((q) => Math.min(99, q + 1))}
          />
        </View>
        <PrimaryButton
          style={styles.addButton}
          disabled={missing.length > 0}
          label={
            missing[0]
              ? messages.product.missing(missing[0].name)
              : reward
                ? messages.loyalty.addGift
                : messages.product.add(formatPrice(total))
          }
          onPress={add}
        />
      </View>
    </Screen>
  );
}

function StepButton({
  label,
  a11y,
  onPress,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
}) {
  const { palette } = useTenant();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={[styles.step, { borderColor: palette.border }]}
    >
      <Text style={[styles.stepText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 32 },
  close: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },
  closeText: { fontSize: 16, fontWeight: '600' },
  photoBox: { backgroundColor: '#FFFFFF', height: 260, padding: 12, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  giftBanner: { padding: 12, borderRadius: 12, fontWeight: '800', overflow: 'hidden' },
  title: { fontSize: 26, fontWeight: '700', marginTop: 8 },
  base: { fontSize: 18, fontWeight: '600' },
  group: { marginTop: 20, gap: 6 },
  /** Étape imbriquée d'une formule : en retrait sous l'option qui l'ouvre. */
  nested: { marginTop: 8, paddingLeft: 16 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupTitle: { fontSize: 18, fontWeight: '700' },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2 },
  optionName: { flex: 1, fontSize: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 64,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 22, fontWeight: '600' },
  qty: { minWidth: 24, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  addButton: { flex: 1 },
});
