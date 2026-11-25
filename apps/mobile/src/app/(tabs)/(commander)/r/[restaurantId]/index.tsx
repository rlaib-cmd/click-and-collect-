import type { ProductDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMenu } from '@/api/hooks';
import { CartBar } from '@/components/CartBar';
import { ProductCard } from '@/components/ProductCard';
import { RewardBanner } from '@/components/RewardBanner';
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
  // Barre des catégories : la catégorie choisie revient au centre, ce qui montre les suivantes.
  const tabsBar = useRef<ScrollViewInstance>(null);
  const tabLayouts = useRef<Record<number, { x: number; width: number }>>({});
  const [bar, setBar] = useState({ width: 0, content: 0, scroll: 0 });
  const moreOnRight = bar.content > bar.width + bar.scroll + 4;

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
    const tab = tabLayouts.current[index];
    if (tab && bar.width > 0) {
      tabsBar.current?.scrollTo({
        x: Math.max(0, tab.x + tab.width / 2 - bar.width / 2),
        animated: true,
      });
    }
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

      <RewardBanner restaurantId={restaurantId} />

      {menu.data.stale ? (
        <Text
          style={[styles.notice, { backgroundColor: palette.surface, color: palette.text }]}
          accessibilityRole="alert"
        >
          {messages.menu.staleNotice}
        </Text>
      ) : null}

      <View style={styles.tabsWrap}>
        <ScrollView
          ref={tabsBar}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          style={styles.tabsBar}
          scrollEventThrottle={32}
          onLayout={(e) => {
            const width = e.nativeEvent.layout.width;
            setBar((b) => ({ ...b, width }));
          }}
          onContentSizeChange={(content) => setBar((b) => ({ ...b, content }))}
          onScroll={(e) => {
            const scroll = e.nativeEvent.contentOffset.x;
            setBar((b) => ({ ...b, scroll }));
          }}
        >
          {sections.map((s, i) => {
            const selected = i === active;
            return (
              <Pressable
                key={s.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => goTo(i)}
                onLayout={(e) => {
                  const { x, width } = e.nativeEvent.layout;
                  tabLayouts.current[i] = { x, width };
                }}
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
        {moreOnRight ? (
          <View pointerEvents="none" style={styles.tabsFade}>
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="fondu" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={palette.background} stopOpacity="0" />
                  <Stop offset="1" stopColor={palette.background} stopOpacity="1" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#fondu)" />
            </Svg>
          </View>
        ) : null}
      </View>

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
  tabsWrap: { flexGrow: 0, flexShrink: 0 },
  tabsBar: { flexGrow: 0, flexShrink: 0 },
  tabsFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 48 },
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
