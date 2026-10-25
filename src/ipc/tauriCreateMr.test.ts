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

// F-27.6: Create merge request of S-11 calls `gitlab_create_mr` with the request in one argument
// (`request`: target, title as typed, description, reviewerIds, draft, removeSourceBranch, squash;
// the core adds the `Draft: ` prefix and reads the source branch from the repository) and returns
// what the core sends unchanged.
describe('Tauri IPC client create MR (F-27.6)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({});
  });

  const request = {
    target: 'develop',
    title: 'Enable compiled bindings',
    description: '## What\nx',
    reviewerIds: [2, 3],
    draft: true,
    removeSourceBranch: true,
    squash: false,
  };

  it('F-27.6 calls gitlab_create_mr by its contract name with the request', async () => {
    await createTauriClient().gitlabCreateMr(request);
    expect(invokeMock.mock.calls).toEqual([['gitlab_create_mr', { request }]]);
  });

  it('F-27.6 hands the created MR of the core on unchanged', async () => {
    const created = {
      iid: 483,
      title: 'Draft: Enable compiled bindings',
      webUrl: 'https://gitlab.local/mobile/mobile-app/-/merge_requests/483',
      pipeline: { id: 18361, status: 'running' },
    };
    invokeMock.mockResolvedValueOnce(created);
    await expect(createTauriClient().gitlabCreateMr(request)).resolves.toEqual(created);
  });
});
