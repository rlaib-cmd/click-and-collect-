import { describe, expect, it } from 'vitest';
import { createNotificationSender, textToHtml } from './sender';

function recorder() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(new Response('{"messageId":"<1@relay>"}', { status: 201 }));
  };
  return { calls, fetchImpl };
}

describe('e-mails Brevo', () => {
  it('envoie un e-mail transactionnel avec la clé dans l’en-tête api-key', async () => {
    const { calls, fetchImpl } = recorder();
    const sender = createNotificationSender({
      brevo: {
        apiKey: 'xkeysib-test-0000',
        senderEmail: 'commande@exemple.fr',
        senderName: 'Bills Burger',
      },
      log: () => undefined,
      fetchImpl,
    });
    await sender.email('client@exemple.fr', {
      subject: 'Commande n° 1002',
      text: 'Merci !\n\nTotal : 3,50 €',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0]?.init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test-0000');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      sender: { email: 'commande@exemple.fr', name: 'Bills Burger' },
      to: [{ email: 'client@exemple.fr' }],
      subject: 'Commande n° 1002',
      textContent: 'Merci !\n\nTotal : 3,50 €',
      htmlContent: textToHtml('Merci !\n\nTotal : 3,50 €'),
    });
  });

  it('sans Brevo, journalise sans envoyer ni exposer l’adresse', async () => {
    const { calls, fetchImpl } = recorder();
    const logs: unknown[] = [];
    const sender = createNotificationSender({ log: (_m, d) => logs.push(d), fetchImpl });
    await sender.email('client@exemple.fr', { subject: 'Reçu', text: 'x' });
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(logs)).not.toContain('client@exemple.fr');
  });

  it('échappe le HTML du texte', () => {
    expect(textToHtml('<b>1 & 2</b>\nligne')).toContain('&lt;b&gt;1 &amp; 2&lt;/b&gt;<br>ligne');
  });

  it('signale un refus de Brevo', async () => {
    const sender = createNotificationSender({
      brevo: { apiKey: 'xkeysib-test-0000', senderEmail: 'a@b.fr', senderName: 'X' },
      log: () => undefined,
      fetchImpl: () => Promise.resolve(new Response('{}', { status: 401 })),
    });
    await expect(sender.email('c@d.fr', { subject: 's', text: 't' })).rejects.toThrow(
      'Brevo : HTTP 401',
    );
  });
});
