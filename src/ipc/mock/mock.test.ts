import { describe, expect, it } from 'vitest';
import { createMockClient, DEFAULT_SETTINGS, MOCK_SETTINGS_KEY } from '.';
import type { UnfinishedSession } from '../types/UnfinishedSession';
import { health } from './fixtures/app';
import { restoreRoute } from './route-restore';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const session: UnfinishedSession = {
  id: 's1',
  status: 'reviewing',
  mode: 'focus',
  updatedAt: '2026-10-11T09:00:00Z',
  resume: { screen: 'S-03', sessionId: 's1' },
  source: { kind: 'local', scope: { kind: 'uncommitted' } },
  title: 'chore/compiled-bindings',
  reviewedSteps: 2,
  totalSteps: 6,
  drafts: 0,
};

describe('mock IPC client', () => {
  it('returns fixture data', async () => {
    await expect(createMockClient({ latencyMs: 0 }).appHealth()).resolves.toEqual(health);
  });

  it('returns copies, so callers cannot change the fixtures', async () => {
    const h = await createMockClient({ latencyMs: 0 }).appHealth();
    h.version = 'changed';
    expect(health.version).toBe('0.1.0');
  });

  it('starts with the default settings and no unfinished sessions', async () => {
    const client = createMockClient({ latencyMs: 0 });
    await expect(client.appSettingsGet()).resolves.toEqual(DEFAULT_SETTINGS);
    await expect(client.sessionsListUnfinished()).resolves.toEqual([]);
    await expect(client.appStartRoute()).resolves.toEqual({ screen: 'S-01' });
  });

  it('applies settings patches and keeps them across clients with the same storage', async () => {
    const storage = memoryStorage();
    const first = createMockClient({ latencyMs: 0, storage });
    const saved = await first.appSettingsSet({ ui: { lastRoute: { screen: 'S-06' } } });
    expect(saved.ui.lastRoute).toEqual({ screen: 'S-06' });
    expect(saved.ui.startIn).toBe('focus');
    expect(storage.data.has(MOCK_SETTINGS_KEY)).toBe(true);
    const second = createMockClient({ latencyMs: 0, storage });
    await expect(second.appStartRoute()).resolves.toEqual({ screen: 'S-06' });
  });

  it('F-30.4 restores a session screen only while the session exists', async () => {
    const storage = memoryStorage();
    await createMockClient({ latencyMs: 0, storage }).appSettingsSet({
      ui: { lastRoute: { screen: 'S-03', sessionId: 's1' } },
    });
    const withSession = createMockClient({ latencyMs: 0, storage, sessions: [session] });
    await expect(withSession.appStartRoute()).resolves.toEqual({
      screen: 'S-03',
      sessionId: 's1',
    });
    const without = createMockClient({ latencyMs: 0, storage });
    await expect(without.appStartRoute()).resolves.toEqual({ screen: 'S-01' });
  });
});

describe('restoreRoute (mock copy of the core rule)', () => {
  it('F-30.4 sends GitLab screens to S-01 and New MR to S-06', () => {
    expect(restoreRoute({ screen: 'S-08', iid: 482 }, () => true)).toEqual({ screen: 'S-01' });
    expect(restoreRoute({ screen: 'S-10', iid: 480 }, () => true)).toEqual({ screen: 'S-01' });
    expect(restoreRoute({ screen: 'S-11' }, () => true)).toEqual({ screen: 'S-06' });
    expect(restoreRoute({ screen: 'S-07', section: 'claude' }, () => false)).toEqual({
      screen: 'S-07',
      section: 'claude',
    });
  });
});
