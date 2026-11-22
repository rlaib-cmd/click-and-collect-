/**
 * Invitation des comptes du back-office (lot 9) : Supabase Auth envoie un lien qui ouvre la page
 * « Choisir mon mot de passe » du back-office. Le compte existe déjà (réinvitation) : un lien de
 * réinitialisation est envoyé à la place.
 */
export type InviteOutcome = 'invited' | 'reset_sent' | 'failed';

export interface AuthInviter {
  invite(email: string): Promise<InviteOutcome>;
}

export interface SupabaseInviterOptions {
  /** URL du projet Supabase (https://<ref>.supabase.co). */
  readonly url: string;
  /** Clé de service : côté serveur uniquement. */
  readonly serviceKey: string;
  /** Page du back-office ouverte par le lien (…/mot-de-passe). */
  readonly redirectTo: string;
  readonly fetch?: typeof fetch;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
}

/** Clé de service historique (JWT) : aussi en Authorization ; nouvelles clés (sb_secret_…) : apikey seule. */
function headers(serviceKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    ...(serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {}),
  };
}

export function createSupabaseInviter(o: SupabaseInviterOptions): AuthInviter {
  const doFetch = o.fetch ?? fetch;
  const base = o.url.replace(/\/+$/, '');
  const query = `?redirect_to=${encodeURIComponent(o.redirectTo)}`;
  const post = (path: string, email: string) =>
    doFetch(`${base}/auth/v1/${path}${query}`, {
      method: 'POST',
      headers: headers(o.serviceKey),
      body: JSON.stringify({ email }),
    });

  return {
    async invite(email) {
      try {
        const res = await post('invite', email);
        if (res.ok) return 'invited';
        // 422 : l'utilisateur existe déjà dans Supabase Auth → lien de réinitialisation.
        if (res.status === 422) {
          const reset = await post('recover', email);
          if (reset.ok) return 'reset_sent';
          o.log?.('Lien de réinitialisation refusé', { status: reset.status });
          return 'failed';
        }
        o.log?.('Invitation refusée par Supabase Auth', { status: res.status });
        return 'failed';
      } catch (error) {
        o.log?.('Invitation impossible', { error: String(error) });
        return 'failed';
      }
    },
  };
}

/** Faux inviteur pour les tests : garde les e-mails, échoue pour les adresses listées. */
export function createFakeInviter(failFor: readonly string[] = []) {
  const sent: string[] = [];
  const inviter: AuthInviter = {
    invite(email) {
      if (failFor.includes(email)) return Promise.resolve('failed');
      const outcome: InviteOutcome = sent.includes(email) ? 'reset_sent' : 'invited';
      sent.push(email);
      return Promise.resolve(outcome);
    },
  };
  return { inviter, sent };
}
