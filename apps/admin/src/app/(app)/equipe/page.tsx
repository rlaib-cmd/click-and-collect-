'use client';

import { staffMemberSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { restaurantsSchema } from '@/components/RestaurantPicker';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.team;

export default function TeamPage() {
  const { auth } = useSession();
  const staff = useApi(
    '/staff',
    z.object({ staff: z.array(staffMemberSchema.extend({ tenantId: z.string().nullable() })) }),
  );
  const restaurants = useApi('/restaurants', restaurantsSchema);
  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'staff' as 'staff' | 'tenant_admin',
    restaurantId: '',
  });
  const [error, setError] = useState<string | null>(null);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(auth, '/staff', staffMemberSchema.loose(), {
        method: 'POST',
        body: {
          email: form.email,
          name: form.name || null,
          role: form.role,
          restaurantId: form.role === 'staff' ? form.restaurantId || null : null,
        },
      });
      setForm({ ...form, email: '', name: '' });
      setError(null);
      await staff.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  const disable = async (id: string) => {
    await api(auth, `/staff/${id}`, z.undefined(), { method: 'PATCH', body: { disabled: true } });
    await staff.reload();
  };

  return (
    <div className="stack">
      <h1>{messages.admin.nav.team}</h1>
      <table>
        <thead>
          <tr>
            <th>{t.email}</th>
            <th>{t.name}</th>
            <th>{t.role}</th>
            <th>{messages.admin.common.restaurant}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {staff.data?.staff.map((s) => (
            <tr key={s.id}>
              <td>{s.email}</td>
              <td>{s.name}</td>
              <td>{t.roles[s.role]}</td>
              <td>
                {restaurants.data?.restaurants.find((r) => r.id === s.restaurantId)?.name ?? '—'}
              </td>
              <td>
                <button type="button" className="link danger" onClick={() => void disable(s.id)}>
                  {t.disable}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="card row wrap" onSubmit={(e) => void invite(e)}>
        <input
          type="email"
          required
          placeholder={t.email}
          aria-label={t.email}
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          placeholder={t.name}
          aria-label={t.name}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          aria-label={t.role}
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as 'staff' | 'tenant_admin' })}
        >
          <option value="staff">{t.roles.staff}</option>
          <option value="tenant_admin">{t.roles.tenant_admin}</option>
        </select>
        {form.role === 'staff' ? (
          <select
            required
            aria-label={messages.admin.common.restaurant}
            value={form.restaurantId}
            onChange={(e) => setForm({ ...form, restaurantId: e.target.value })}
          >
            <option value="">{messages.admin.common.restaurant}</option>
            {restaurants.data?.restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        ) : null}
        <button type="submit" className="primary">
          {t.invite}
        </button>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
