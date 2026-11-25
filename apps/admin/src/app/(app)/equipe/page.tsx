'use client';

import { invitationSchema, staffMemberSchema, type StaffMember } from '@splash360/contracts';
import {
  can,
  canAssignRole,
  PERMISSIONS,
  roleNeedsRestaurant,
  TENANT_ROLES,
  type TenantRole,
} from '@splash360/core';
import { messages } from '@splash360/i18n';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { Icon } from '@/components/Icon';
import { restaurantsSchema } from '@/components/RestaurantPicker';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { LoadError } from '@/components/LoadError';

const t = messages.admin.team;
const roles = messages.admin.roles;

const ROLE_STYLE: Record<StaffMember['role'], [string, string]> = {
  super_admin: ['#EEF0FF', '#312E81'],
  tenant_admin: ['#EEF0FF', '#312E81'],
  manager: ['#E8F5EC', '#14532D'],
  staff: ['#FFF4E5', '#7C2D12'],
};
const AVATARS: [string, string][] = [
  ['#FDE7E8', '#9F1239'],
  ['#E0F2FE', '#075985'],
  ['#F3E8FF', '#6B21A8'],
  ['#ECFCCB', '#3F6212'],
];

// Schéma stable (audit du 25/11, F01) : jamais recréé pendant le rendu.
const teamSchema = z.object({ staff: z.array(staffMemberSchema) });

/** Équipe et accès (maquette du lot 13, ADR 0017) : comptes, droits par rôle, invitation. */
export default function TeamPage() {
  const { auth, me } = useSession();
  const staff = useApi('/staff', teamSchema);
  const restaurants = useApi('/restaurants', restaurantsSchema);
  const [form, setForm] = useState({
    email: '',
    role: 'manager' as TenantRole,
    restaurantId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const manageable = can(me.role, 'team');
  const tenantName = me.tenant?.name ?? '';
  const restaurantName = (id: string | null) =>
    id ? (restaurants.data?.restaurants.find((r) => r.id === id)?.name ?? '') : t.allRestaurants;

  const fail = (err: unknown) =>
    setError(err instanceof Error ? err.message : messages.admin.common.error);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      const created = await api(
        auth,
        '/staff',
        z.object({ email: z.string() }).extend(invitationSchema.shape),
        {
          method: 'POST',
          body: {
            email: form.email.trim(),
            name: null,
            role: form.role,
            restaurantId:
              form.role === 'tenant_admin' ? null : form.restaurantId ? form.restaurantId : null,
          },
        },
      );
      setForm({ ...form, email: '' });
      setError(null);
      setNotice(
        created.invitationSent
          ? t.invitationSent(created.email)
          : t.invitationFailed(created.email),
      );
      await staff.reload();
    } catch (err) {
      fail(err);
    }
  };

  const patch = async (m: StaffMember, body: Record<string, unknown>) => {
    try {
      await api(auth, `/staff/${m.id}`, z.undefined(), { method: 'PATCH', body });
      setError(null);
      await staff.reload();
    } catch (err) {
      fail(err);
    }
  };

  const changeRole = (m: StaffMember, role: TenantRole) => {
    const restaurantId = roleNeedsRestaurant(role)
      ? (m.restaurantId ?? restaurants.data?.restaurants[0]?.id ?? null)
      : role === 'tenant_admin'
        ? null
        : m.restaurantId;
    void patch(m, { role, restaurantId });
  };

  const resend = async (m: StaffMember) => {
    try {
      const r = await api(auth, `/staff/${m.id}/invite`, invitationSchema, { method: 'POST' });
      setNotice(r.invitationSent ? t.invitationSent(m.email) : t.invitationFailed(m.email));
    } catch (err) {
      fail(err);
    }
  };

  const remove = async (m: StaffMember) => {
    if (!window.confirm(t.confirmDelete(m.email))) return;
    try {
      await api(auth, `/staff/${m.id}`, z.undefined(), { method: 'DELETE' });
      await staff.reload();
    } catch (err) {
      fail(err);
    }
  };

  const members = staff.data?.staff ?? [];
  const needsRestaurant = roleNeedsRestaurant(form.role);

  return (
    <>
      <LoadError
        error={staff.error ?? restaurants.error}
        onRetry={() => {
          void staff.reload();
          void restaurants.reload();
        }}
      />
      <header className="row wrap" style={{ gap: 14 }}>
        <Link href="/accueil" className="row" style={{ gap: 6, fontWeight: 600, fontSize: 14 }}>
          <Icon name="back" size={18} />
          {messages.admin.studio.back}
        </Link>
        <h1 style={{ fontSize: 26 }}>{messages.admin.nav.team}</h1>
      </header>
      {error ? (
        <p className="banner danger" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="banner info" role="status">
          {notice}
        </p>
      ) : null}

      <div className="home">
        <div className="home-main">
          <section className="card" aria-labelledby="members">
            <div className="row between" style={{ marginBottom: 6 }}>
              <h2 id="members" style={{ margin: 0 }}>
                {t.membersTitle}
              </h2>
              <span className="muted" style={{ fontSize: 13 }}>
                {t.count(members.length)}
              </span>
            </div>
            {members.map((m, i) => {
              const [abg, afg] = AVATARS[i % AVATARS.length] ?? AVATARS[0]!;
              const [rbg, rfg] = ROLE_STYLE[m.role];
              const self = m.email === me.email;
              return (
                <div key={m.id} className="member" data-testid={`member-${m.email}`}>
                  <div
                    className="avatar"
                    style={{ background: abg, color: afg }}
                    aria-hidden="true"
                  >
                    {(m.name ?? m.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="who">
                    <strong>
                      {m.name ?? m.email}
                      {self ? ` (${t.you})` : ''}
                    </strong>
                    <span>{m.email}</span>
                  </div>
                  {manageable && !self && m.role !== 'super_admin' ? (
                    <select
                      aria-label={`${t.changeRole} : ${m.email}`}
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value as TenantRole)}
                      style={{ minWidth: 140 }}
                    >
                      {TENANT_ROLES.filter((r) => canAssignRole(me.role, r)).map((r) => (
                        <option key={r} value={r}>
                          {roles[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="pill" style={{ background: rbg, color: rfg }}>
                      {roles[m.role]}
                    </span>
                  )}
                  <span style={{ minWidth: 150, fontSize: 13, color: 'var(--text-2)' }}>
                    {restaurantName(m.restaurantId)}
                  </span>
                  {m.disabled ? <span className="pill danger">{t.disabled}</span> : null}
                  {m.pending && !m.disabled ? (
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>
                      {t.pending}
                      {manageable ? (
                        <>
                          {' · '}
                          <button type="button" className="link" onClick={() => void resend(m)}>
                            {t.resend}
                          </button>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {manageable && !self ? (
                    <span className="row" style={{ gap: 4 }}>
                      <button
                        type="button"
                        className="link"
                        onClick={() => void patch(m, { disabled: !m.disabled })}
                      >
                        {m.disabled ? t.enable : t.disable}
                      </button>
                      <button type="button" className="link danger" onClick={() => void remove(m)}>
                        {t.delete}
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </section>

          <section className="card stack" aria-labelledby="matrix" style={{ gap: 12 }}>
            <h2 id="matrix" style={{ margin: 0 }}>
              {t.matrixTitle}
            </h2>
            <div className="table-box" style={{ border: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t.matrixAccess}</th>
                    {TENANT_ROLES.map((r) => (
                      <th key={r} scope="col" style={{ textAlign: 'center' }}>
                        {roles[r]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.filter((p) => p !== 'platform').map((p) => (
                    <tr key={p}>
                      <th scope="row" style={{ fontWeight: 600 }}>
                        {messages.admin.permissions[p]}
                      </th>
                      {TENANT_ROLES.map((r) => (
                        <td key={r} className={can(r, p) ? 'yes' : 'no'}>
                          <span aria-hidden="true">{can(r, p) ? '✓' : '—'}</span>
                          <span className="visually-hidden">{can(r, p) ? 'oui' : 'non'}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {t.matrixHint(tenantName)}
            </p>
          </section>
        </div>

        <section className="home-aside card stack" aria-labelledby="invite">
          <h2 id="invite" style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: 0 }}>
            {t.inviteTitle}
          </h2>
          {manageable ? (
            <form className="stack" onSubmit={(e) => void invite(e)}>
              <label>
                {t.email}
                <input
                  type="email"
                  required
                  placeholder={t.emailPlaceholder}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <fieldset style={{ border: 0, padding: 0 }}>
                <legend style={{ padding: 0, marginBottom: 8, fontSize: 14 }}>{t.role}</legend>
                <div className="stack" role="radiogroup" aria-label={t.role} style={{ gap: 8 }}>
                  {TENANT_ROLES.filter((r) => canAssignRole(me.role, r)).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={form.role === r}
                      className="role-card"
                      onClick={() => setForm({ ...form, role: r })}
                    >
                      <span className="radio-dot" aria-hidden="true" />
                      <span>
                        <strong>{roles[r]}</strong>
                        <span className="hint">{messages.admin.roleHints[r]}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {form.role !== 'tenant_admin' ? (
                <label>
                  {t.restaurant}
                  <select
                    required={needsRestaurant}
                    value={form.restaurantId}
                    onChange={(e) => setForm({ ...form, restaurantId: e.target.value })}
                  >
                    {needsRestaurant ? (
                      <option value="">—</option>
                    ) : (
                      <option value="">{t.allRestaurants}</option>
                    )}
                    {restaurants.data?.restaurants.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button type="submit" className="primary">
                {t.send}
              </button>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {t.footer}
              </p>
            </form>
          ) : (
            <p className="muted">{t.readOnly}</p>
          )}
        </section>
      </div>
    </>
  );
}
