import type { ProductDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMenu } from '@/api/hooks';
import { CartBar } from '@/components/CartBar';
import { ProductCard } from '@/components/ProductCard';
import { SetupSummary } from '@/components/SetupSummary';
import { BrandBar, titleStyle } from '@/components/brand';
import { TenantLogo } from '@/components/TenantLogo';
import { BackButton, ErrorState, Loading, Screen } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';

export default function MenuScreen() {
  const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();
  const { config, palette, style, radii } = useTenant();
  const brandHeader = style.header === 'brand';
  const menu = useMenu(restaurantId);
  const insets = useSafeAreaInsets();
  const list = useRef<SectionList<readonly ProductDto[]>>(null);
  const [active, setActive] = useState(0);

  // Grille à deux colonnes : chaque élément de section est une paire de produits.
  const sections = useMemo(
    () =>
      (menu.data?.categories ?? []).map((c) => ({
        key: c.id,
        title: c.name,
        image: c.products.find((p) => p.imageUrl)?.imageUrl ?? null,
        data: pairs(c.products),
      })),
    [menu.data],
  );

  if (menu.isPending) return <Loading />;
  if (menu.isError)
    return <ErrorState message={messages.menu.menuError} onRetry={() => void menu.refetch()} />;

  const goTo = (index: number) => {
    setActive(index);
    list.current?.scrollToLocation({
      sectionIndex: index,
      itemIndex: 0,
      viewOffset: 48,
      animated: true,
    });
  };

  return (
    <Screen>
      <BrandBar paddingTop={insets.top + 8}>
        <BackButton color={brandHeader ? palette.onPrimary : palette.accent} />
        {brandHeader && config.theme.logoUrl ? (
          <TenantLogo size={36} wide />
        ) : (
          <>
            <TenantLogo size={40} />
            <Text
              style={[
                styles.headerTitle,
                titleStyle(style),
                { color: brandHeader ? palette.onPrimary : palette.text },
              ]}
              accessibilityRole="header"
            >
              {config.tenant.name}
            </Text>
          </>
        )}
      </BrandBar>

      <View style={styles.summary}>
        <SetupSummary />
      </View>

      {menu.data.stale ? (
        <Text
          style={[styles.notice, { backgroundColor: palette.surface, color: palette.text }]}
          accessibilityRole="alert"
        >
          {messages.menu.staleNotice}
        </Text>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        style={styles.tabsBar}
      >
        {sections.map((s, i) => {
          const selected = i === active;
          return (
            <Pressable
              key={s.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => goTo(i)}
              style={[
                styles.tab,
                {
                  backgroundColor: selected ? palette.primary : palette.surface,
                  borderColor: palette.border,
                  borderRadius: radii.chip,
                },
              ]}
            >
              {s.image ? (
                <Image
                  source={{ uri: s.image }}
                  style={[styles.tabImage, { backgroundColor: '#FFFFFF' }]}
                  contentFit="contain"
                  accessibilityIgnoresInvertColors
                />
              ) : null}
              <Text
                style={[
                  { color: selected ? palette.onPrimary : palette.text, fontWeight: '700' },
                  titleStyle(style),
                ]}
              >
                {s.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <SectionList
        ref={list}
        sections={sections}
        keyExtractor={(row) => row.map((p) => p.id).join('+')}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        onScrollToIndexFailed={() => undefined}
        renderSectionHeader={({ section }) => (
          <Text
            style={[styles.section, titleStyle(style), { color: palette.text }]}
            accessibilityRole="header"
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <View style={styles.gridRow}>
            {item.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onPress={() =>
                  router.push({
                    pathname: '/r/[restaurantId]/p/[productId]',
                    params: { restaurantId, productId: product.id },
                  })
                }
              />
            ))}
            {item.length === 1 ? <View style={styles.gridFiller} /> : null}
          </View>
        )}
      />
      <CartBar menu={menu.data} />
    </Screen>
  );
}

function pairs<T>(items: readonly T[]): (readonly T[])[] {
  const out: (readonly T[])[] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}

const styles = StyleSheet.create({
  headerTitle: { fontSize: 20, fontWeight: '700' },
  summary: { paddingHorizontal: 16, paddingTop: 12 },
  notice: { padding: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 8 },
  // Ne jamais se tasser : la liste en dessous prend la place restante.
  tabsBar: { flexGrow: 0, flexShrink: 0 },
  tabs: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: {
    minHeight: 44,
    paddingLeft: 6,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabImage: { width: 32, height: 32, borderRadius: 16 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  section: { fontSize: 24, fontWeight: '900', marginTop: 20, marginBottom: 12 },
  gridRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  gridFiller: { flex: 1 },
});
