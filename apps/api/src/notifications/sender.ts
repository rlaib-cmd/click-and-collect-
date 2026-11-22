/** Notifications au client : push mobile (Expo) et e-mail. */
export interface NotificationSender {
  push(
    tokens: readonly string[],
    message: { title: string; body: string; data: Record<string, string> },
  ): Promise<void>;
  email(to: string, message: { subject: string; text: string }): Promise<void>;
}

/**
 * Push via le service Expo (https://exp.host/--/api/v2/push/send).
 * E-mail : prestataire à choisir (voir questions en attente) ; journalisé en attendant.
 */
export function createNotificationSender(options: {
  expoAccessToken?: string | undefined;
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
    email(to, message) {
      options.log('E-mail (prestataire non configuré)', {
        to: to.replace(/^(.).*@/, '$1***@'),
        subject: message.subject,
      });
      return Promise.resolve();
    },
  };
}

export function createFakeNotificationSender() {
  const pushes: { tokens: readonly string[]; title: string; body: string }[] = [];
  const emails: { to: string; subject: string; text: string }[] = [];
  const sender: NotificationSender = {
    push(tokens, m) {
      pushes.push({ tokens, title: m.title, body: m.body });
      return Promise.resolve();
    },
    email(to, m) {
      emails.push({ to, ...m });
      return Promise.resolve();
    },
  };
  return { sender, pushes, emails };
}
