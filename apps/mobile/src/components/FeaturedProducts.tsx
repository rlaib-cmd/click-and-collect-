import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMenu, useRestaurants } from '@/api/hooks';
import { titleStyle } from '@/components/brand';
import { ProductCard } from '@/components/ProductCard';
import { featuredProducts, homeRestaurant } from '@/menu/featured';
import { useTenant } from '@/tenant/TenantProvider';

/**
 * « En ce moment » (retour du testeur Bills Burger) : produits que la marque met en avant au
 * back-office, en carrousel sur l'accueil. Rien n'est affiché sans produit mis en avant.
 */
export function FeaturedProducts() {
  const { config, palette, style } = useTenant();
  const restaurants = useRestaurants();
  const restaurantId = homeRestaurant(restaurants.data) ?? '';
  const menu = useMenu(restaurantId);
  const products = featuredProducts(menu.data);
  if (products.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text
        style={[styles.title, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {messages.loyalty.featuredTitle(config.tenant.name)}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        style={styles.scroller}
      >
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            width={170}
            accessibilityLabel={messages.loyalty.featuredOrder(p.name)}
            onPress={() => router.navigate({ pathname: '/commander', params: { mode: 'pickup' } })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  // Le carrousel déborde des marges de la page pour montrer qu'il défile.
  scroller: { marginHorizontal: -16 },
  row: { gap: 12, paddingHorizontal: 16, paddingBottom: 4 },
});
