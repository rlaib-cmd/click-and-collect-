import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTenant } from '@/tenant/TenantProvider';

export interface SlotOption {
  readonly at: string;
  readonly label: string;
}

/**
 * Choix de l'heure en liste déroulante : un champ compact qui ouvre une feuille en bas d'écran.
 * La page reste courte et le bouton « Voir la carte » reste visible.
 */
export function SlotPicker({
  slots,
  selectedAt,
  dayLabel,
  loading,
  onSelect,
}: {
  slots: readonly SlotOption[];
  selectedAt: string | null;
  dayLabel: string;
  loading: boolean;
  onSelect: (at: string) => void;
}) {
  const { palette, radii } = useTenant();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const t = messages.setup;
  const selected = slots.find((s) => s.at === selectedAt) ?? null;
  const empty = !loading && slots.length === 0;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? t.timeChosen(dayLabel, selected.label) : t.pickTime}
        accessibilityState={{ disabled: empty || loading, expanded: open }}
        disabled={empty || loading}
        onPress={() => setOpen(true)}
        style={[
          styles.field,
          {
            borderColor: selected ? palette.primary : palette.border,
            backgroundColor: palette.surface,
            borderRadius: radii.button,
          },
        ]}
      >
        <Text
          style={[styles.fieldText, { color: selected ? palette.text : palette.textMuted }]}
          numberOfLines={1}
        >
          {empty ? t.noSlots : loading ? t.loadingSlots : (selected?.label ?? t.pickTime)}
        </Text>
        {empty ? null : <Text style={[styles.chevron, { color: palette.accent }]}>▾</Text>}
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel={t.closePicker}
          onPress={() => setOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: palette.background, paddingBottom: insets.bottom + 12 },
          ]}
          accessibilityViewIsModal
        >
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            {t.pickTimeTitle(dayLabel)}
          </Text>
          <FlatList
            data={slots}
            keyExtractor={(s) => s.at}
            style={styles.list}
            initialNumToRender={20}
            renderItem={({ item }) => {
              const active = item.at === selectedAt;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, selected: active }}
                  onPress={() => {
                    onSelect(item.at);
                    setOpen(false);
                  }}
                  style={[
                    styles.row,
                    { borderColor: palette.border },
                    active ? { backgroundColor: palette.surface } : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.rowText,
                      { color: active ? palette.accent : palette.text },
                      active ? styles.rowActive : null,
                    ]}
                  >
                    {item.label}
                  </Text>
                  {active ? <Text style={[styles.check, { color: palette.accent }]}>✓</Text> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 52,
    borderWidth: 2,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  fieldText: { fontSize: 17, fontWeight: '700', flex: 1 },
  chevron: { fontSize: 20, fontWeight: '900' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    maxHeight: '65%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  handle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '800', marginBottom: 8 },
  list: { flexGrow: 0 },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  rowText: { fontSize: 18 },
  rowActive: { fontWeight: '800' },
  check: { fontSize: 18, fontWeight: '900' },
});
