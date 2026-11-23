import { messages } from '@splash360/i18n';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TAB_CENTER_RAISE } from '@/components/layout';
import { Icon, type IconName } from '@/components/icons';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';

const TABS: readonly { name: string; label: string; icon: IconName; loyalty: boolean }[] = [
  { name: 'index', label: messages.tabs.home, icon: 'home', loyalty: false },
  { name: 'avantages', label: messages.tabs.rewards, icon: 'gift', loyalty: true },
  { name: '(commander)', label: messages.tabs.order, icon: 'burger', loyalty: false },
  { name: 'carte', label: messages.tabs.card, icon: 'qr', loyalty: true },
  { name: 'compte', label: messages.tabs.account, icon: 'user', loyalty: false },
];

/**
 * Barre à 5 onglets (lot 8, maquette option A) : Commander au centre, en relief.
 * Sans club fidélité, Avantages et Ma carte disparaissent.
 */
function TabBar({ state, navigateToTab, insets }: BottomTabBarProps) {
  const { palette } = useTenant();
  const { enabled } = useLoyalty();
  const current = state.routes[state.index]?.name;
  const visible = TABS.filter((t) => enabled || !t.loyalty);
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
      accessibilityRole="tablist"
    >
      {visible.map((tab) => {
        const route = state.routes.find((r) => r.name === tab.name);
        if (!route) return null;
        const selected = current === tab.name;
        const center = tab.name === '(commander)';
        const color = selected || center ? palette.accent : palette.textMuted;
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={() => navigateToTab(route.key)}
            style={[styles.tab, center ? styles.centerTab : null]}
          >
            {center ? (
              <View
                style={[
                  styles.centerButton,
                  { backgroundColor: palette.primary, borderColor: palette.background },
                ]}
              >
                <Icon name={tab.icon} color={palette.onPrimary} size={28} />
              </View>
            ) : (
              <Icon name={tab.icon} color={color} />
            )}
            <Text
              style={[
                styles.label,
                { color, fontWeight: selected || center ? '800' : '600' },
                center ? styles.centerLabel : null,
              ]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { palette } = useTenant();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: palette.background } }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3, minHeight: 48 },
  centerTab: { marginTop: -TAB_CENTER_RAISE },
  centerButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11 },
  centerLabel: { textTransform: 'uppercase' },
});
