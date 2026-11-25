'use client';

import {
  createTenantSchema,
  invitationSchema,
  tenantSummarySchema,
  type TenantSummaryDto,
} from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api } from '@/lib/api';
import { tenantState, type ConsoleState } from '@/lib/console';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { LoadError } from '@/components/LoadError';

const t = messages.admin.tenants;
const c = messages.admin.console;

type Filter = 'all' | 'live' | 'setup' | 'blocked';

const PILL: Record<ConsoleState, string> = {
  live: 'pill success',
  draft: 'pill warning',
  setup: 'pill info',
  blocked: 'pill danger',
};

const readableOn = (hex: string | null) => {
  const h = (hex ?? '#3730A3').replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  return lum > 0.55 ? '#17171C' : '#FFFFFF';
};

// Schéma stable (audit du 25/11, F01) : jamais recréé pendant le rendu.
const tenantsSchema = z.object({ tenants: z.array(tenantSummarySchema) });

/** Console Splash360 (maquette du lot 13) : toutes les enseignes, « voir comme le client ». */
export default function ConsolePage() {
  const { auth, me, setTenant } = useSession();
  const router = useRouter();
  // Pas de lecture pour un rôle sans droit à la console (audit du 25/11, F04).
  const tenants = useApi(me.role === 'super_admin' ? '/tenants' : null, tenantsSchema);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', subdomain: '', splash360Id: '', adminEmail: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (me.role !== 'super_admin') return <p>{messages.admin.common.forbidden}</p>;

  const fail = (err: unknown) =>
    setError(err instanceof Error ? err.message : messages.admin.common.error);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!createTenantSchema.safeParse(form).success) return setError(messages.admin.common.error);
    try {
      const created = await api(
        auth,
        '/tenants',
        z.object({ tenantId: z.uuid() }).extend(invitationSchema.shape),
        { method: 'POST', body: form },
      );
      setNotice(
        created.invitationSent ? t.created(form.adminEmail) : t.createdNoInvite(form.adminEmail),
      );
      setForm({ name: '', subdomain: '', splash360Id: '', adminEmail: '' });
      setCreating(false);
      setError(null);
      await tenants.reload();
    } catch (err) {
      fail(err);
    }
  };

  const update = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(auth, `/tenants/${id}`, z.undefined(), { method: 'PATCH', body });
      await tenants.reload();
    } catch (err) {
      fail(err);
    }
  };

  const toggleBlock = async (x: TenantSummaryDto) => {
    const blocking = x.status === 'active';
    if (!window.confirm(blocking ? t.confirmBlock(x.name) : t.confirmUnblock(x.name))) return;
    await update(x.id, { status: blocking ? 'suspended' : 'active' });
  };

  const remove = async (x: TenantSummaryDto) => {
    const typed = window.prompt(t.confirmDelete(x.name));
    if (typed === null) return;
    if (typed.trim() !== x.name) return setError(t.deleteMismatch);
    try {
      await api(auth, `/tenants/${x.id}`, z.undefined(), { method: 'DELETE' });
      setError(null);
      await tenants.reload();
    } catch (err) {
      fail(err);
    }
  };

  const viewAs = (x: TenantSummaryDto) => {
    setTenant(x.id);
    router.push('/accueil');
  };

  const rows = (tenants.data?.tenants ?? [])
    .map((x) => ({ ...x, state: tenantState(x) }))
    .filter(
      (x) => filter === 'all' || x.state === filter || (filter === 'live' && x.state === 'draft'),
    );

  return (
    <>
      <LoadError error={tenants.error} onRetry={() => void tenants.reload()} />
      <header className="page-head">
        <div>
          <h1>{c.title}</h1>
          <p>{c.intro}</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreating((v) => !v)}>
          {c.newTenant}
        </button>
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

      {creating ? (
        <form className="card stack" onSubmit={(e) => void create(e)} aria-label={t.create}>
          <h2 style={{ margin: 0 }}>{t.create}</h2>
          <div className="grid">
            {(['name', 'subdomain', 'splash360Id', 'adminEmail'] as const).map((k) => (
              <label key={k}>
                {t[k]}
                <input
                  required
                  type={k === 'adminEmail' ? 'email' : 'text'}
                  value={form[k]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [k]: k === 'subdomain' ? e.target.value.toLowerCase() : e.target.value,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="row">
            <button type="submit" className="primary">
              {t.create}
            </button>
            <button type="button" className="ghost" onClick={() => setCreating(false)}>
              {messages.admin.studio.notNow}
            </button>
          </div>
        </form>
      ) : null}

      <div className="filters" role="tablist" aria-label={c.title}>
        {(Object.keys(c.filters) as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
          >
            {c.filters[f]}
          </button>
        ))}
      </div>

      <div className="table-box">
        <table style={{ minWidth: 920 }}>
          <thead>
            <tr>
              <th scope="col">{c.columns.tenant}</th>
              <th scope="col">{c.columns.app}</th>
              <th scope="col">{c.columns.restaurants}</th>
              <th scope="col" className="num">
                {c.columns.fee}
              </th>
              <th scope="col" className="num">
                {c.columns.actions}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  {c.empty}
                </td>
              </tr>
            ) : null}
            {rows.map((x) => (
              <tr key={x.id} data-testid={`tenant-${x.subdomain}`}>
                <td>
                  <div className="row" style={{ gap: 12 }}>
                    <div
                      className="avatar"
                      style={{
                        borderRadius: 10,
                        width: 40,
                        height: 40,
                        background: x.primaryColor ?? '#3730A3',
                        color: readableOn(x.primaryColor),
                      }}
                      aria-hidden="true"
                    >
                      {x.name.charAt(0)}
                    </div>
                    <div>
                      <strong>{x.name}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {x.subdomain} · {x.splash360Id}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={PILL[x.state]}>
                    <span className="dot" />
                    {c.status[x.state]}
                  </span>
                </td>
                <td style={{ color: 'var(--text-2)' }}>{c.restaurants(x.restaurants)}</td>
                <td className="num">
                  <input
                    aria-label={`${t.fee} : ${x.name}`}
                    className="small"
                    defaultValue={(x.applicationFeeBps / 100).toString().replace('.', ',')}
                    onBlur={(e) =>
                      void update(x.id, {
                        applicationFeeBps: Math.round(
                          Number(e.target.value.replace(',', '.')) * 100,
                        ),
                      })
                    }
                  />
                </td>
                <td className="num">
                  <span className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" className="dark" onClick={() => viewAs(x)}>
                      {c.viewAs}
                    </button>
                    <button type="button" onClick={() => void toggleBlock(x)}>
                      {x.status === 'active' ? t.block : t.unblock}
                    </button>
                    <button type="button" className="link danger" onClick={() => void remove(x)}>
                      {t.delete}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="steps3">
        {c.steps.map(([title, text]) => (
          <div key={title} className="card">
            <p style={{ margin: '0 0 6px', fontWeight: 800 }}>{title}</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {text}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
