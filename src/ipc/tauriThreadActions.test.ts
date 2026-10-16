import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTauriClient } from './tauri';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (message: unknown) => void = () => undefined;
  },
}));
const invokeMock = vi.mocked(invoke);

// F-11.2: the two thread commands, by their contract names (docs/04 › IPC contract, plan M5). The
// MR is never sent from the UI: the core takes the project and the iid from the session.

describe('Tauri IPC client: thread actions (F-11.2)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it('F-11.2 gitlab_resolve sends the session, the discussion and the resolved flag, nothing else', async () => {
    const client = createTauriClient();
    await client.gitlabResolve('mock-mr-session-1', 'd-482-3', true);
    await client.gitlabResolve('mock-mr-session-1', 'd-482-3', false);
    expect(invokeMock.mock.calls).toEqual([
      ['gitlab_resolve', { session: 'mock-mr-session-1', discussion: 'd-482-3', resolved: true }],
      ['gitlab_resolve', { session: 'mock-mr-session-1', discussion: 'd-482-3', resolved: false }],
    ]);
  });

  it('F-11.2 gitlab_reply sends the session, the discussion and the text as written, nothing else', async () => {
    const client = createTauriClient();
    const body = 'Zażółć gęślą jaźń:\n- `Kick()`';
    await client.gitlabReply('mock-mr-session-1', 'd-482-3', body);
    expect(invokeMock.mock.calls).toEqual([
      ['gitlab_reply', { session: 'mock-mr-session-1', discussion: 'd-482-3', body }],
    ]);
  });
});
