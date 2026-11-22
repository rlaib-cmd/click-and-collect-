import { describe, expect, it } from 'vitest';
import { createSupabaseInviter } from './invite';

function recorder(statuses: number[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response('{}', { status: statuses.shift() ?? 500 }));
  };
  return { calls, fetchFn };
}

const options = (fetchFn: typeof fetch, serviceKey = 'eyJ.service.key') => ({
  url: 'https://projet.supabase.co/',
  serviceKey,
  redirectTo: 'https://admin.example.fr/mot-de-passe',
  fetch: fetchFn,
});

describe('invitation Supabase Auth', () => {
  it('invite avec la clé de service et la page de mot de passe en retour', async () => {
    const r = recorder([200]);
    expect(await createSupabaseInviter(options(r.fetchFn)).invite('a@b.test')).toBe('invited');
    expect(r.calls[0]?.url).toBe(
      'https://projet.supabase.co/auth/v1/invite?redirect_to=https%3A%2F%2Fadmin.example.fr%2Fmot-de-passe',
    );
    const headers = r.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.apikey).toBe('eyJ.service.key');
    expect(headers.Authorization).toBe('Bearer eyJ.service.key');
    expect(r.calls[0]?.init?.body).toBe(JSON.stringify({ email: 'a@b.test' }));
  });

  it('compte déjà existant : envoie un lien de réinitialisation', async () => {
    const r = recorder([422, 200]);
    expect(await createSupabaseInviter(options(r.fetchFn)).invite('a@b.test')).toBe('reset_sent');
    expect(r.calls[1]?.url).toContain('/auth/v1/recover?redirect_to=');
  });

  it('signale un échec sans lever d’erreur ; nouvelle clé secrète sans en-tête Authorization', async () => {
    const r = recorder([500]);
    const inviter = createSupabaseInviter(options(r.fetchFn, 'sb_secret_abcdefghijklmnop'));
    expect(await inviter.invite('a@b.test')).toBe('failed');
    expect((r.calls[0]?.init?.headers as Record<string, string>).Authorization).toBeUndefined();
    const broken = createSupabaseInviter(options(() => Promise.reject(new Error('réseau'))));
    expect(await broken.invite('a@b.test')).toBe('failed');
  });
});
