'use client';

import { customerRowSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { z } from 'zod';
import { api, download, euros } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.customers;

export default function CustomersPage() {
  const { auth } = useSession();
  const [q, setQ] = useState('');
  const { data, reload } = useApi(
    `/customers${q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
    z.object({ customers: z.array(customerRowSchema) }),
  );

  const remove = async (id: string) => {
    if (!window.confirm(t.confirmDelete)) return;
    await api(auth, `/customers/${id}`, z.undefined(), { method: 'DELETE' });
    await reload();
  };

  return (
    <div className="stack">
      <header className="row between">
        <h1>{messages.admin.nav.customers}</h1>
        <button
          type="button"
          onClick={() => void download(auth, '/customers/export', 'clients.csv')}
        >
          {t.export}
        </button>
      </header>
      <input
        type="search"
        placeholder={t.search}
        aria-label={t.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <table>
        <thead>
          <tr>
            <th>{messages.admin.team.name}</th>
            <th>E-mail</th>
            <th>Téléphone</th>
            <th className="num">{t.orders}</th>
            <th className="num">{t.spent}</th>
            <th>{t.consent}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.customers.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.email}</td>
              <td>{c.phone}</td>
              <td className="num">{c.orders}</td>
              <td className="num">{euros(c.spentCents)}</td>
              <td>{c.marketingConsent ? messages.admin.common.yes : messages.admin.common.no}</td>
              <td>
                <button type="button" className="link danger" onClick={() => void remove(c.id)}>
                  {t.delete}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
