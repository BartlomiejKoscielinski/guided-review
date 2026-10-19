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

// F-12.7: a draft made outside a review (Explain failure on S-08, Add as a question on S-12) is sent
// with the MR it belongs to, project + iid, and no session: the core picks the latest session of
// the MR or creates the "drafts only" one (`drafts_create_for_mr`, docs/plans/M5.md item 10).

describe('Tauri IPC client: drafts of the MR (F-12.7)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it('F-12.7 drafts_create_for_mr sends the project, the iid and the draft, and returns the saved draft', async () => {
    const saved = {
      id: 'd1',
      sessionId: 'drafts-only-1',
      findingId: null,
      body: 'Is the keystore secret set for this branch?',
      position: null,
      severity: 'q',
      include: true,
      publishedNoteId: null,
      error: null,
      stepId: null,
      outdated: false,
    };
    invokeMock.mockResolvedValue(saved);
    const client = createTauriClient();
    const draft = {
      body: 'Is the keystore secret set for this branch?',
      position: null,
      severity: 'q',
    } as const;

    await expect(client.draftsCreateForMr('mobile/mobile-app', 482, draft)).resolves.toEqual(saved);

    expect(invokeMock.mock.calls).toEqual([
      ['drafts_create_for_mr', { project: 'mobile/mobile-app', iid: 482, draft }],
    ]);
  });
});
