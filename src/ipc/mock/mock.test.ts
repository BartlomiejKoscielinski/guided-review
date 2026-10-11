import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { health } from './fixtures/app';

describe('mock IPC client', () => {
  it('returns fixture data', async () => {
    await expect(createMockClient({ latencyMs: 0 }).appHealth()).resolves.toEqual(health);
  });

  it('returns copies, so callers cannot change the fixtures', async () => {
    const h = await createMockClient({ latencyMs: 0 }).appHealth();
    h.version = 'changed';
    expect(health.version).toBe('0.1.0');
  });
});
