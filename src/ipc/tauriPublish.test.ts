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

// F-12.5: the two publish commands by their contract names (docs/04 › IPC contract, plan M5).
// The core takes the MR, the diff and the reviewed version from the session; the UI sends the
// session, the ticked draft ids and the summary text (null when none goes out) and nothing else.

describe('Tauri IPC client: publish (F-12.5)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it('F-12.5 drafts_publish sends the session, the draft ids and the summary text and returns the outcome', async () => {
    const outcome = {
      published: ['d1', 'd3'],
      summary: true,
      failed: [{ id: 'd2', reason: 'the line is no longer in the MR' }],
    };
    invokeMock.mockResolvedValue(outcome);
    const client = createTauriClient();
    await expect(
      client.draftsPublish('mock-mr-session-1', ['d1', 'd2', 'd3'], 'Looks good overall.'),
    ).resolves.toEqual(outcome);
    expect(invokeMock.mock.calls).toEqual([
      [
        'drafts_publish',
        { session: 'mock-mr-session-1', ids: ['d1', 'd2', 'd3'], summary: 'Looks good overall.' },
      ],
    ]);
  });

  it('F-12.5 drafts_publish without a summary sends null', async () => {
    invokeMock.mockResolvedValue({ published: ['d1'], summary: false, failed: [] });
    const client = createTauriClient();
    await client.draftsPublish('mock-mr-session-1', ['d1'], null);
    expect(invokeMock.mock.calls).toEqual([
      ['drafts_publish', { session: 'mock-mr-session-1', ids: ['d1'], summary: null }],
    ]);
  });

  it('F-12.5 gitlab_foreign_drafts sends only the session and returns the count', async () => {
    invokeMock.mockResolvedValue(2);
    const client = createTauriClient();
    await expect(client.gitlabForeignDrafts('mock-mr-session-1')).resolves.toBe(2);
    expect(invokeMock.mock.calls).toEqual([
      ['gitlab_foreign_drafts', { session: 'mock-mr-session-1' }],
    ]);
  });
});
