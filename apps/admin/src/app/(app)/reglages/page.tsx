'use client';

import { settingsSchema, type AdminRestaurant, type SettingsDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { RestaurantPicker } from '@/components/RestaurantPicker';
import { api, fromCents, toCents } from '@/lib/api';
import { useSession } from '@/lib/session';

const t = messages.admin.settings;

/** Réglages de commande par restaurant (section 6). */
export default function SettingsPage() {
  const { auth } = useSession();
  const [restaurant, setRestaurant] = useState<AdminRestaurant | null>(null);
  const pick = useCallback((r: AdminRestaurant) => setRestaurant(r), []);
  const [s, setS] = useState<SettingsDto | null>(null);
  const [money, setMoney] = useState({ minimum: '', free: '', service: '' });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    void api(auth, `/restaurants/${restaurant.id}/settings`, z.unknown()).then((raw) => {
      const parsed = settingsSchema.safeParse(raw);
      if (!parsed.success) return;
      setS(parsed.data);
      setMoney({
        minimum: fromCents(parsed.data.deliveryMinimumCents),
        free: fromCents(parsed.data.freeDeliveryThresholdCents),
        service: fromCents(parsed.data.serviceFeeCents),
      });
    });
  }, [auth, restaurant]);

  if (!s) {
    return (
      <div className="stack">
        <h1>{messages.admin.nav.settings}</h1>
        <RestaurantPicker value={restaurant?.id ?? null} onChange={pick} />
        <p className="muted">{messages.admin.common.loading}</p>
      </div>
    );
  }

  const set = <K extends keyof SettingsDto>(k: K, v: SettingsDto[K]) => setS({ ...s, [k]: v });
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))));

  const save = async () => {
    const candidate = {
      ...s,
      deliveryMinimumCents: toCents(money.minimum || '0'),
      freeDeliveryThresholdCents: money.free.trim() ? toCents(money.free) : null,
      serviceFeeCents: toCents(money.service || '0'),
    };
    const parsed = settingsSchema.safeParse(candidate);
    if (!parsed.success)
      return setStatus(parsed.error.issues[0]?.message ?? messages.admin.common.error);
    try {
      await api(auth, `/restaurants/${restaurant?.id ?? ''}/settings`, z.undefined(), {
        method: 'PUT',
        body: parsed.data,
      });
      setStatus(messages.admin.common.saved);
    } catch {
      setStatus(messages.admin.common.error);
    }
  };

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <header className="row between">
        <h1>{messages.admin.nav.settings}</h1>
        <RestaurantPicker value={restaurant?.id ?? null} onChange={pick} />
      </header>

      <fieldset className="card grid">
        <legend>{t.modes}</legend>
        <label className="inline">
          <input
            type="checkbox"
            checked={s.pickupEnabled}
            onChange={(e) => set('pickupEnabled', e.target.checked)}
          />{' '}
          {t.pickup}
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={s.deliveryEnabled}
            onChange={(e) => set('deliveryEnabled', e.target.checked)}
          />{' '}
          {t.delivery}
        </label>
        <label>
          {t.prep}
          <input
            type="number"
            min={0}
            max={240}
            value={s.prepMinutes}
            onChange={(e) => set('prepMinutes', num(e.target.value) ?? 0)}
          />
        </label>
        <label>
          {t.deliveryTime}
          <input
            type="number"
            min={0}
            max={240}
            value={s.deliveryMinutes}
            onChange={(e) => set('deliveryMinutes', num(e.target.value) ?? 0)}
          />
        </label>
        <label>
          {t.step}
          <select
            value={s.slotStepMinutes}
            onChange={(e) => set('slotStepMinutes', Number(e.target.value) as 10 | 15 | 30)}
          >
            {[10, 15, 30].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.maxPerSlot}
          <input
            type="number"
            min={1}
            value={s.maxOrdersPerSlot ?? ''}
            onChange={(e) => set('maxOrdersPerSlot', num(e.target.value))}
          />
        </label>
        <label>
          {t.daysAhead}
          <input
            type="number"
            min={0}
            max={30}
            value={s.daysAhead}
            onChange={(e) => set('daysAhead', num(e.target.value) ?? 0)}
          />
        </label>
        <label>
          {t.minimum}
          <input
            inputMode="decimal"
            value={money.minimum}
            onChange={(e) => setMoney({ ...money, minimum: e.target.value })}
          />
        </label>
        <label>
          {t.freeThreshold}
          <input
            inputMode="decimal"
            value={money.free}
            onChange={(e) => setMoney({ ...money, free: e.target.value })}
          />
        </label>
        <label>
          {t.serviceFee}
          <input
            inputMode="decimal"
            value={money.service}
            onChange={(e) => setMoney({ ...money, service: e.target.value })}
          />
        </label>
      </fieldset>

      <fieldset className="card stack">
        <legend>{t.hours}</legend>
        {s.openingHours.map((h, i) => (
          <div key={i} className="row">
            <select
              aria-label="Jour"
              value={h.isoWeekday}
              onChange={(e) =>
                set(
                  'openingHours',
                  s.openingHours.map((x, j) =>
                    j === i ? { ...x, isoWeekday: Number(e.target.value) } : x,
                  ),
                )
              }
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  {t.days[d]}
                </option>
              ))}
            </select>
            <input
              type="time"
              aria-label="Ouverture"
              value={h.opens}
              onChange={(e) =>
                set(
                  'openingHours',
                  s.openingHours.map((x, j) => (j === i ? { ...x, opens: e.target.value } : x)),
                )
              }
            />
            <input
              type="time"
              aria-label="Fermeture"
              value={h.closes}
              onChange={(e) =>
                set(
                  'openingHours',
                  s.openingHours.map((x, j) => (j === i ? { ...x, closes: e.target.value } : x)),
                )
              }
            />
            <button
              type="button"
              className="link"
              onClick={() =>
                set(
                  'openingHours',
                  s.openingHours.filter((_, j) => j !== i),
                )
              }
            >
              {t.remove}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            set('openingHours', [
              ...s.openingHours,
              { isoWeekday: 1, opens: '11:30', closes: '14:30' },
            ])
          }
        >
          {t.addRange}
        </button>
      </fieldset>

      <fieldset className="card stack">
        <legend>{t.closures}</legend>
        {s.closures.map((c, i) => (
          <div key={i} className="row">
            <input
              type="date"
              aria-label="Date"
              value={c.day}
              onChange={(e) =>
                set(
                  'closures',
                  s.closures.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)),
                )
              }
            />
            <input
              aria-label="Motif"
              value={c.reason ?? ''}
              onChange={(e) =>
                set(
                  'closures',
                  s.closures.map((x, j) =>
                    j === i ? { ...x, reason: e.target.value || null } : x,
                  ),
                )
              }
            />
            <button
              type="button"
              className="link"
              onClick={() =>
                set(
                  'closures',
                  s.closures.filter((_, j) => j !== i),
                )
              }
            >
              {t.remove}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            set('closures', [
              ...s.closures,
              { day: new Date().toISOString().slice(0, 10), reason: null },
            ])
          }
        >
          {t.addClosure}
        </button>
      </fieldset>

      <fieldset className="card stack">
        <legend>{t.zones}</legend>
        {s.zones.map((z2, i) => {
          const update = (patch: Partial<SettingsDto['zones'][number]>) =>
            set(
              'zones',
              s.zones.map((x, j) => (j === i ? { ...x, ...patch } : x)),
            );
          return (
            <div key={i} className="row wrap">
              <input
                aria-label="Nom"
                value={z2.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              <select
                aria-label="Type"
                value={z2.kind}
                onChange={(e) => update({ kind: e.target.value as 'radius' | 'postal_codes' })}
              >
                <option value="radius">{t.radius}</option>
                <option value="postal_codes">{t.postalCodes}</option>
              </select>
              {z2.kind === 'radius' ? (
                <input
                  type="number"
                  aria-label={t.radius}
                  value={z2.radiusMeters ?? ''}
                  onChange={(e) => update({ radiusMeters: num(e.target.value) })}
                />
              ) : (
                <input
                  aria-label={t.postalCodes}
                  value={z2.postalCodes.join(', ')}
                  onChange={(e) =>
                    update({ postalCodes: e.target.value.split(/[\s,;]+/).filter(Boolean) })
                  }
                />
              )}
              <label className="inline">
                {t.fee}
                <input
                  inputMode="decimal"
                  className="small"
                  value={fromCents(z2.feeCents)}
                  onChange={(e) => update({ feeCents: toCents(e.target.value || '0') })}
                />
              </label>
              <button
                type="button"
                className="link"
                onClick={() =>
                  set(
                    'zones',
                    s.zones.filter((_, j) => j !== i),
                  )
                }
              >
                {t.remove}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() =>
            set('zones', [
              ...s.zones,
              {
                name: 'Nouvelle zone',
                kind: 'radius',
                radiusMeters: 3000,
                postalCodes: [],
                feeCents: 290,
              },
            ])
          }
        >
          {t.addZone}
        </button>
      </fieldset>

      <div className="row">
        <button type="submit" className="primary">
          {messages.admin.common.save}
        </button>
        {status ? <p role="status">{status}</p> : null}
      </div>
    </form>
  );
}
