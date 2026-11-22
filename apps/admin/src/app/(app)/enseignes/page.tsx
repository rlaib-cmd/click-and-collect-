'use client';

import { createTenantSchema, tenantSummarySchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.tenants;

/** Comptes clients Splash360 (super-administrateur). */
export default function TenantsPage() {
  const { auth, me, setTenant } = useSession();
  const tenants = useApi('/tenants', z.object({ tenants: z.array(tenantSummarySchema) }));
  const [form, setForm] = useState({ name: '', subdomain: '', splash360Id: '', adminEmail: '' });
  const [error, setError] = useState<string | null>(null);
  if (me.role !== 'super_admin') return <p>{messages.admin.common.forbidden}</p>;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!createTenantSchema.safeParse(form).success) return setError(messages.admin.common.error);
    try {
      await api(auth, '/tenants', z.object({ tenantId: z.uuid() }), { method: 'POST', body: form });
      setForm({ name: '', subdomain: '', splash360Id: '', adminEmail: '' });
      setError(null);
      await tenants.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  const update = async (id: string, body: Record<string, unknown>) => {
    await api(auth, `/tenants/${id}`, z.undefined(), { method: 'PATCH', body });
    await tenants.reload();
  };

  const toggleBlock = async (x: { id: string; name: string; status: string }) => {
    const blocking = x.status === 'active';
    if (!window.confirm(blocking ? t.confirmBlock(x.name) : t.confirmUnblock(x.name))) return;
    await update(x.id, { status: blocking ? 'suspended' : 'active' });
  };

  const remove = async (x: { id: string; name: string }) => {
    const typed = window.prompt(t.confirmDelete(x.name));
    if (typed === null) return;
    if (typed.trim() !== x.name) return setError(t.deleteMismatch);
    try {
      await api(auth, `/tenants/${x.id}`, z.undefined(), { method: 'DELETE' });
      setError(null);
      if (auth.tenantId === x.id) setTenant(null);
      await tenants.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  return (
    <div className="stack">
      <h1>{messages.admin.nav.tenants}</h1>
      {error ? (
        <p className="banner danger" role="alert">
          {error}
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>{t.name}</th>
            <th>{t.subdomain}</th>
            <th>{t.splash360Id}</th>
            <th className="num">{t.fee}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tenants.data?.tenants.map((x) => (
            <tr key={x.id} className={x.status === 'suspended' ? 'muted' : ''}>
              <td>
                {x.name}
                {x.status === 'suspended' ? (
                  <span className="badge blocked">{t.blocked}</span>
                ) : null}
              </td>
              <td>{x.subdomain}</td>
              <td>{x.splash360Id}</td>
              <td className="num">
                <input
                  aria-label={t.fee}
                  className="small"
                  defaultValue={(x.applicationFeeBps / 100).toString().replace('.', ',')}
                  onBlur={(e) =>
                    void update(x.id, {
                      applicationFeeBps: Math.round(Number(e.target.value.replace(',', '.')) * 100),
                    })
                  }
                />
              </td>
              <td className="row">
                <button type="button" onClick={() => setTenant(x.id)}>
                  {t.open}
                </button>
                <button
                  type="button"
                  className={x.status === 'active' ? 'link danger' : 'link'}
                  onClick={() => void toggleBlock(x)}
                >
                  {x.status === 'active' ? t.block : t.unblock}
                </button>
                <button type="button" className="link danger" onClick={() => void remove(x)}>
                  {t.delete}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="card stack" onSubmit={(e) => void create(e)}>
        <h2>{t.create}</h2>
        <div className="row wrap">
          {(['name', 'subdomain', 'splash360Id', 'adminEmail'] as const).map((k) => (
            <input
              key={k}
              required
              placeholder={t[k]}
              aria-label={t[k]}
              value={form[k]}
              onChange={(e) =>
                setForm({
                  ...form,
                  [k]: k === 'subdomain' ? e.target.value.toLowerCase() : e.target.value,
                })
              }
            />
          ))}
          <button type="submit" className="primary">
            {t.create}
          </button>
        </div>
      </form>
    </div>
  );
}
