import type { AddressDto, Availability } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAddressSearch, useDeliveryCheck, useSlots } from '@/api/hooks';
import type { OrderSetup } from '@/cart/cart';
import { formatDay, formatTime, localDate } from '@/lib/dates';
import { formatPrice } from '@/lib/format';
import { useTenant } from '@/tenant/TenantProvider';
import { Chip } from './Chip';
import { SlotPicker } from './SlotPicker';

/** Mode, adresse, jour et heure (section 4, écran Accueil). */
export function SetupForm({
  restaurantId,
  availability,
  setup,
  onChange,
  planning,
  onPlanningChange,
}: {
  restaurantId: string;
  availability: Availability;
  setup: OrderSetup;
  onChange: (patch: Partial<OrderSetup>) => void;
  /** Le client a choisi « Planifier » (créneau pas forcément encore choisi). */
  planning: boolean;
  onPlanningChange: (planning: boolean) => void;
}) {
  const { palette } = useTenant();
  const tz = availability.timezone;
  const now = new Date();
  const modes = (['delivery', 'pickup'] as const).filter((m) => availability.modes[m]);
  const scheduledDate =
    setup.time.kind === 'scheduled' ? localDate(new Date(setup.time.at), tz) : null;
  const [day, setDay] = useState<string | null>(scheduledDate ?? availability.dates[0] ?? null);
  const scheduling = planning || !availability.asap.available;
  const slots = useSlots(restaurantId, setup.mode, scheduling ? day : null);

  // Mode imposé s'il n'y en a qu'un ; « dès que possible » impossible → planifier.
  useEffect(() => {
    if (modes.length > 0 && !modes.includes(setup.mode)) onChange({ mode: modes[0] ?? 'pickup' });
  }, [modes, setup.mode, onChange]);

  return (
    <View style={styles.form}>
      {modes.length > 1 ? (
        <View style={styles.row} accessibilityRole="radiogroup">
          {modes.map((m) => (
            <Chip
              key={m}
              label={messages.setup[m]}
              selected={setup.mode === m}
              onPress={() => onChange({ mode: m })}
            />
          ))}
        </View>
      ) : null}

      {setup.mode === 'delivery' ? (
        <AddressField
          restaurantId={restaurantId}
          availability={availability}
          address={setup.address}
          onChange={(address) => onChange({ address })}
        />
      ) : null}

      <Text style={[styles.label, { color: palette.text }]}>{messages.setup.when}</Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        <Chip
          label={
            availability.asap.available
              ? `${messages.setup.asap} · ${messages.setup.asapEta(formatTime(availability.asap.estimatedAt, tz))}`
              : messages.setup.asapClosed
          }
          selected={!scheduling}
          disabled={!availability.asap.available}
          onPress={() => {
            onPlanningChange(false);
            onChange({ time: { kind: 'asap' } });
          }}
        />
        {availability.dates.length > 0 ? (
          <Chip
            label={messages.setup.schedule}
            selected={scheduling}
            onPress={() => {
              onPlanningChange(true);
              if (!day) setDay(availability.dates[0] ?? null);
            }}
          />
        ) : null}
      </View>

      {scheduling && availability.dates.length > 0 ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {availability.dates.map((d) => (
              <Chip
                key={d}
                label={formatDay(d, now, tz, messages.setup)}
                selected={d === day}
                onPress={() => setDay(d)}
              />
            ))}
          </ScrollView>
          <SlotPicker
            slots={slots.data?.slots ?? []}
            loading={slots.isPending}
            dayLabel={day ? formatDay(day, now, tz, messages.setup) : ''}
            selectedAt={setup.time.kind === 'scheduled' ? setup.time.at : null}
            onSelect={(at) => onChange({ time: { kind: 'scheduled', at } })}
          />
        </>
      ) : null}
    </View>
  );
}

function AddressField({
  restaurantId,
  availability,
  address,
  onChange,
}: {
  restaurantId: string;
  availability: Availability;
  address: AddressDto | null;
  onChange: (address: AddressDto | null) => void;
}) {
  const { palette } = useTenant();
  const [query, setQuery] = useState(address?.label ?? '');
  const [open, setOpen] = useState(false);
  const search = useAddressSearch(open ? query : '');
  const check = useDeliveryCheck(restaurantId, address);
  const delivery = availability.delivery;

  return (
    <View style={styles.address}>
      <Text style={[styles.label, { color: palette.text }]}>{messages.setup.address}</Text>
      <TextInput
        value={query}
        onChangeText={(t) => {
          setQuery(t);
          setOpen(true);
          if (address) onChange(null);
        }}
        placeholder={messages.setup.addressPlaceholder}
        placeholderTextColor={palette.textMuted}
        autoComplete="street-address"
        accessibilityLabel={messages.setup.address}
        style={[styles.input, { borderColor: palette.border, color: palette.text }]}
      />
      {open && query.trim().length >= 3 ? (
        <View
          style={[
            styles.suggestions,
            { borderColor: palette.border, backgroundColor: palette.surface },
          ]}
        >
          {search.data?.length === 0 ? (
            <Text style={[styles.suggestion, { color: palette.textMuted }]}>
              {messages.setup.addressNotFound}
            </Text>
          ) : null}
          {search.data?.map((r) => (
            <Pressable
              key={r.label}
              accessibilityRole="button"
              onPress={() => {
                onChange({ ...r, instructions: null });
                setQuery(r.label);
                setOpen(false);
              }}
              style={styles.suggestion}
            >
              <Text style={{ color: palette.text }}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {address && check.data ? (
        <Text
          style={{ color: check.data.deliverable ? palette.textMuted : palette.accent }}
          accessibilityRole={check.data.deliverable ? undefined : 'alert'}
        >
          {check.data.deliverable
            ? [
                messages.setup.deliverable(formatPrice(check.data.feeCents)),
                delivery?.freeThresholdCents
                  ? messages.setup.freeAbove(formatPrice(delivery.freeThresholdCents))
                  : null,
              ]
                .filter(Boolean)
                .join(', ')
            : messages.setup.notDeliverable}
        </Text>
      ) : null}
      {delivery && delivery.minimumCents > 0 ? (
        <Text style={{ color: palette.textMuted }}>
          {messages.setup.minimum(formatPrice(delivery.minimumCents))}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12, alignSelf: 'stretch' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { fontSize: 17, fontWeight: '700', marginTop: 4 },
  address: { gap: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
  suggestions: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  suggestion: { paddingHorizontal: 12, paddingVertical: 12, minHeight: 44 },
});
