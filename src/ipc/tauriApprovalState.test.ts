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

// F-14.1: `gitlab_approval_state(session)` (docs/04 › IPC contract, plan M5). The MR is never sent
// from the UI: the core takes the project and the iid from the session. The answer is the core's
// ApprovalState in camelCase, handed on as it is.

describe('Tauri IPC client: approval state (F-14.1)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('F-14.1 gitlab_approval_state sends only the session and returns the core state as it is', async () => {
    const state = {
      approvedBy: [{ username: 'alice', name: 'Alice Stand-in' }],
      approvalsRequired: 2,
      userHasApproved: false,
      userCanApprove: true,
      requirePasswordToApprove: false,
    };
    invokeMock.mockResolvedValue(state);
    const client = createTauriClient();

    await expect(client.gitlabApprovalState('mock-mr-session-1')).resolves.toEqual(state);

    expect(invokeMock.mock.calls).toEqual([
      ['gitlab_approval_state', { session: 'mock-mr-session-1' }],
    ]);
  });
});
