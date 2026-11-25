'use client';

import { messages } from '@splash360/i18n';
import { z } from 'zod';
import { useApi } from '@/lib/use-api';
import { LoadError } from '@/components/LoadError';

const t = messages.admin.audit;
const schema = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      actorEmail: z.string(),
      target: z.string().nullable(),
      detail: z.unknown(),
      at: z.string(),
    }),
  ),
});

export default function AuditPage() {
  const { data, error, reload } = useApi('/audit', schema);
  return (
    <div className="stack">
      <LoadError error={error} onRetry={() => void reload()} />
      <h1>{messages.admin.nav.audit}</h1>
      <table>
        <thead>
          <tr>
            <th>{t.at}</th>
            <th>{t.action}</th>
            <th>{t.actor}</th>
            <th>{t.target}</th>
          </tr>
        </thead>
        <tbody>
          {data?.entries.map((e, i) => (
            <tr key={i}>
              <td>{new Date(e.at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}</td>
              <td>
                <code>{e.action}</code>
              </td>
              <td>{e.actorEmail}</td>
              <td className="muted">{e.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
