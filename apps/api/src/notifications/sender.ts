/** Notifications au client : push mobile (Expo) et e-mail. */
export interface NotificationSender {
  push(
    tokens: readonly string[],
    message: { title: string; body: string; data: Record<string, string> },
  ): Promise<void>;
  email(to: string, message: { subject: string; text: string }): Promise<void>;
}

/** Brevo, e-mails transactionnels (https://developers.brevo.com/reference/send-transac-email). */
export interface BrevoConfig {
  readonly apiKey: string;
  /** Adresse d'expédition vérifiée dans Brevo (domaine authentifié). */
  readonly senderEmail: string;
  readonly senderName: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Corps HTML minimal tiré du texte : Brevo l'exige sans modèle. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<html><body style="font-family:system-ui,sans-serif">${paragraphs}</body></html>`;
}

/**
 * Push via le service Expo (https://exp.host/--/api/v2/push/send).
 * E-mail via Brevo quand il est configuré (BREVO_API_KEY), sinon seulement journalisé.
 */
export function createNotificationSender(options: {
  expoAccessToken?: string | undefined;
  brevo?: BrevoConfig | undefined;
  log: (m: string, d?: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}): NotificationSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async push(tokens, message) {
      if (tokens.length === 0) return;
      const res = await fetchImpl('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(options.expoAccessToken
            ? { Authorization: `Bearer ${options.expoAccessToken}` }
            : {}),
        },
        body: JSON.stringify(tokens.map((to) => ({ to, sound: 'default', ...message }))),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Expo push : HTTP ${res.status}`);
    },
    async email(to, message) {
      const brevo = options.brevo;
      if (!brevo) {
        options.log('E-mail (prestataire non configuré)', {
          to: to.replace(/^(.).*@/, '$1***@'),
          subject: message.subject,
        });
        return;
      }
      const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'api-key': brevo.apiKey,
        },
        body: JSON.stringify({
          sender: { email: brevo.senderEmail, name: brevo.senderName },
          to: [{ email: to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: textToHtml(message.text),
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Brevo : HTTP ${res.status}`);
    },
  };
}

export function createFakeNotificationSender() {
  const pushes: {
    tokens: readonly string[];
    title: string;
    body: string;
    data: Record<string, string>;
  }[] = [];
  const emails: { to: string; subject: string; text: string }[] = [];
  const sender: NotificationSender = {
    push(tokens, m) {
      pushes.push({ tokens, title: m.title, body: m.body, data: m.data });
      return Promise.resolve();
    },
    email(to, m) {
      emails.push({ to, ...m });
      return Promise.resolve();
    },
  };
  return { sender, pushes, emails };
}
