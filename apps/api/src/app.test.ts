import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('GET /health', () => {
  it('répond ok', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', currency: 'EUR', zero: 0 });
  });
});
