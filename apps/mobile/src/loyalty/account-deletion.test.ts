import { messages } from '@splash360/i18n';
import { describe, expect, it } from 'vitest';
import { deleteAccount, deletionConsequences, farewellMessage } from './account-deletion';

function steps(options: { failRequest?: boolean; failProximity?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    steps: {
      request: () => {
        calls.push('request');
        return options.failRequest ? Promise.reject(new Error('réseau')) : Promise.resolve();
      },
      stopProximity: () => {
        calls.push('proximity');
        return options.failProximity ? Promise.reject(new Error('système')) : Promise.resolve();
      },
      logout: () => {
        calls.push('logout');
      },
    },
  };
}

describe('supprimer mon compte (ADR 0028)', () => {
  it('serveur d’abord, puis arrêt des bons plans à proximité et déconnexion locale', async () => {
    const s = steps();
    expect(await deleteAccount(s.steps, false)).toBe('deleted');
    expect(s.calls).toEqual(['request', 'proximity', 'logout']);
  });

  it('échec côté serveur : le compte reste connecté sur l’appareil', async () => {
    const s = steps({ failRequest: true });
    await expect(deleteAccount(s.steps, false)).rejects.toThrow('réseau');
    expect(s.calls).toEqual(['request']);
  });

  it('arrêt des bons plans en échec : la déconnexion a lieu quand même', async () => {
    const s = steps({ failProximity: true });
    expect(await deleteAccount(s.steps, false)).toBe('deleted');
    expect(s.calls).toEqual(['request', 'proximity', 'logout']);
  });

  it('partenaire de fidélité : effacement demandé, annoncé sous 30 jours', async () => {
    const s = steps();
    const outcome = await deleteAccount(s.steps, true);
    expect(outcome).toBe('deleted_partner');
    expect(farewellMessage(outcome)).toContain('30 jours');
    expect(farewellMessage('deleted')).toBe(messages.accountDeletion.done);
    expect(deletionConsequences(true).at(-1)).toContain('30 jours');
    expect(deletionConsequences(false)).toEqual(messages.accountDeletion.consequences);
  });
});
