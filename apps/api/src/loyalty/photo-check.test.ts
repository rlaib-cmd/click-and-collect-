import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  createClaudePhotoAnalyzer,
  manualPhotoAnalyzer,
  photoCheckToken,
  readPhotoCheckToken,
  sniffImage,
} from './photo-check';

/** Lot 17 (ADR 0022) : analyse de la photo par Claude, avec un client HTTP simulé (aucun appel réel). */
const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const CONTEXT = {
  brand: 'Bills Burger',
  category: 'burgers',
  products: ['Bills Classic', 'Frites maison'],
};

interface Captured {
  url: string;
  headers: Headers;
  body: {
    model: string;
    system: string;
    output_config: { effort: string; format: { type: string } };
    messages: {
      content: { type: string; source?: { data: string; media_type: string }; text?: string }[];
    }[];
  };
}

function simulated(reply: { status?: number; stop_reason?: string; text?: string }) {
  const calls: Captured[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Captured['body'],
    });
    const status = reply.status ?? 200;
    const payload =
      status === 200
        ? {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: reply.text === undefined ? [] : [{ type: 'text', text: reply.text }],
            stop_reason: reply.stop_reason ?? 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
          }
        : { type: 'error', error: { type: 'invalid_request_error', message: 'refusé' } };
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { calls, fetch: fetchFn as typeof fetch };
}

describe('analyse de la photo (Claude)', () => {
  it('envoie l’image et le contexte de l’enseigne, et lit le verdict structuré', async () => {
    const sim = simulated({
      text: JSON.stringify({
        verdict: 'rejected',
        reason: '  Je vois la tour Eiffel,\n pas de burger.',
      }),
    });
    const analyzer = createClaudePhotoAnalyzer({ apiKey: 'sk-test-0000000000', fetch: sim.fetch });
    expect(await analyzer.analyze({ data: IMAGE, mediaType: 'image/jpeg' }, CONTEXT)).toEqual({
      verdict: 'rejected',
      reason: 'Je vois la tour Eiffel, pas de burger.',
      analyzer: 'IA',
    });
    const call = sim.calls[0];
    expect(call?.url).toContain('/v1/messages');
    expect(call?.body.model).toBe('claude-opus-5-5');
    expect(call?.body.output_config.effort).toBe('low');
    expect(call?.body.output_config.format.type).toBe('json_schema');
    const [image, text] = call?.body.messages[0]?.content ?? [];
    expect(image?.source).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data: Buffer.from(IMAGE).toString('base64'),
    });
    expect(JSON.parse(text?.text ?? '{}')).toEqual({
      enseigne: 'Bills Burger',
      categorie: 'burgers',
      produits_de_la_carte: ['Bills Classic', 'Frites maison'],
    });
  });

  it('accepte un modèle réglé par variable d’environnement', async () => {
    const sim = simulated({ text: JSON.stringify({ verdict: 'accepted', reason: 'Un burger.' }) });
    const analyzer = createClaudePhotoAnalyzer({
      apiKey: 'sk-test-0000000000',
      model: 'claude-haiku-5-5',
      fetch: sim.fetch,
    });
    expect((await analyzer.analyze({ data: IMAGE, mediaType: 'image/png' }, CONTEXT)).verdict).toBe(
      'accepted',
    );
    expect(sim.calls[0]?.body.model).toBe('claude-haiku-5-5');
  });

  it('refus du modèle, réponse illisible ou API en erreur : « à vérifier », jamais bloquant', async () => {
    const logs: string[] = [];
    const log = (m: string) => {
      logs.push(m);
    };
    for (const reply of [
      { stop_reason: 'refusal', text: '' },
      { text: 'pas du JSON' },
      { status: 400 },
    ]) {
      const sim = simulated(reply);
      const analyzer = createClaudePhotoAnalyzer({
        apiKey: 'sk-test-0000000000',
        fetch: sim.fetch,
        log,
      });
      const result = await analyzer.analyze({ data: IMAGE, mediaType: 'image/jpeg' }, CONTEXT);
      expect(result).toMatchObject({ verdict: 'doubtful', analyzer: 'IA' });
      expect(result.reason).toBe('Photo à vérifier par le restaurant.');
    }
    expect(logs).toHaveLength(3);
  });

  it('sans clé : vérification manuelle', async () => {
    expect(
      await manualPhotoAnalyzer.analyze({ data: IMAGE, mediaType: 'image/jpeg' }, CONTEXT),
    ).toEqual({
      verdict: 'doubtful',
      reason: 'Photo à vérifier par le restaurant.',
      analyzer: 'manuel',
    });
  });
});

describe('format et jeton du verdict', () => {
  it('reconnaît JPEG, PNG et WebP à leurs premiers octets', () => {
    expect(sniffImage(IMAGE)).toBe('image/jpeg');
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png');
    const webp = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);
    expect(sniffImage(webp)).toBe('image/webp');
    expect(sniffImage(new Uint8Array(Buffer.from('GIF89a')))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it('jeton signé, lié à l’enseigne et au membre, valable 30 minutes', () => {
    const now = new Date('2026-11-25T10:00:00Z');
    const analysis = { verdict: 'accepted', reason: 'Un burger.', analyzer: 'IA' } as const;
    const token = photoCheckToken('secret-0123456789', 't1', 'm1', analysis, now);
    expect(readPhotoCheckToken('secret-0123456789', 't1', 'm1', token, now)).toEqual(analysis);
    expect(readPhotoCheckToken('autre-secret-0000', 't1', 'm1', token, now)).toBeNull();
    expect(readPhotoCheckToken('secret-0123456789', 't2', 'm1', token, now)).toBeNull();
    expect(readPhotoCheckToken('secret-0123456789', 't1', 'm2', token, now)).toBeNull();
    const later = new Date(now.getTime() + 31 * 60_000);
    expect(readPhotoCheckToken('secret-0123456789', 't1', 'm1', token, later)).toBeNull();
    expect(readPhotoCheckToken('secret-0123456789', 't1', 'm1', undefined, now)).toBeNull();
    expect(readPhotoCheckToken('secret-0123456789', 't1', 'm1', 'p1.abc.def', now)).toBeNull();
  });
});
