import { Pressable, StyleSheet, Text } from 'react-native';
import { useTenant } from '@/tenant/TenantProvider';

/** Choix sélectionnable (mode, jour, créneau) ; zone tactile ≥ 44 points. */
export function Chip({
  label,
  selected,
  onPress,
  disabled = false,
  role = 'radio',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  role?: 'radio' | 'tab';
}) {
  const { palette, radii } = useTenant();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ selected, checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? palette.primary : palette.surface,
          borderColor: selected ? palette.primary : palette.border,
          borderRadius: radii.chip,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text style={[styles.text, { color: selected ? palette.onPrimary : palette.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderWidth: 1,
  },
  text: { fontWeight: '600', fontSize: 15 },
});
