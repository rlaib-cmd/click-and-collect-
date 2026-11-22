import type { ProductDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMenu } from '@/api/hooks';
import { CartBar } from '@/components/CartBar';
import { SetupSummary } from '@/components/SetupSummary';
import { TenantLogo } from '@/components/TenantLogo';
import { ErrorState, Loading, Screen } from '@/components/ui';
import { formatPrice } from '@/lib/format';
import { useTenant } from '@/tenant/TenantProvider';

export default function MenuScreen() {
  const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();
  const { config, palette } = useTenant();
  const menu = useMenu(restaurantId);
  const insets = useSafeAreaInsets();
  const list = useRef<SectionList<ProductDto>>(null);
  const [active, setActive] = useState(0);

  const sections = useMemo(
    () =>
      (menu.data?.categories ?? []).map((c) => ({ key: c.id, title: c.name, data: c.products })),
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
      <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: palette.border }]}>
        <TenantLogo size={40} />
        <Text style={[styles.headerTitle, { color: palette.text }]} accessibilityRole="header">
          {config.tenant.name}
        </Text>
      </View>

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
                },
              ]}
            >
              <Text
                style={{ color: selected ? palette.onPrimary : palette.text, fontWeight: '600' }}
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
        keyExtractor={(p) => p.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        onScrollToIndexFailed={() => undefined}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.section, { color: palette.text }]} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            onPress={() =>
              router.push({
                pathname: '/r/[restaurantId]/p/[productId]',
                params: { restaurantId, productId: item.id },
              })
            }
          />
        )}
      />
      <CartBar menu={menu.data} />
    </Screen>
  );
}

function ProductRow({ product, onPress }: { product: ProductDto; onPress: () => void }) {
  const { palette } = useTenant();
  const disabled = !product.available;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, { borderColor: palette.border, opacity: disabled ? 0.45 : 1 }]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.name, { color: palette.text }]}>{product.name}</Text>
        {product.description ? (
          <Text style={{ color: palette.textMuted }} numberOfLines={2}>
            {product.description}
          </Text>
        ) : null}
        <Text style={[styles.price, { color: palette.text }]}>
          {disabled ? messages.menu.unavailable : formatPrice(product.priceCents)}
        </Text>
      </View>
      {product.imageUrl ? (
        <Image
          source={{ uri: product.imageUrl }}
          style={styles.photo}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.photo, { backgroundColor: palette.surface }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  summary: { paddingHorizontal: 16, paddingTop: 12 },
  notice: { padding: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 8 },
  // Ne jamais se tasser : la liste en dessous prend la place restante.
  tabsBar: { flexGrow: 0, flexShrink: 0 },
  tabs: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  section: { fontSize: 20, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  rowText: { flex: 1, gap: 4 },
  name: { fontSize: 17, fontWeight: '600' },
  price: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  photo: { width: 88, height: 88, borderRadius: 12 },
});
