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

// F-27.5: "Before you create" of S-11 calls `git_merge_check` (target or null for the default, like
// `git_branch_info`) and returns what the core sends.
describe('Tauri IPC client merge check (F-27.5)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({});
  });

  it('F-27.5 calls git_merge_check by its contract name', async () => {
    const client = createTauriClient();
    await client.gitMergeCheck();
    await client.gitMergeCheck('release/1.8');
    expect(invokeMock.mock.calls).toEqual([
      ['git_merge_check', { target: null }],
      ['git_merge_check', { target: 'release/1.8' }],
    ]);
  });

  it('F-27.5 hands the answer of the core on unchanged', async () => {
    const answer = {
      branch: 'feature/zażółć',
      target: 'main',
      pushed: 'ahead',
      conflicts: ['App.xaml'],
      selfReview: { reviewed: 2, total: 3, notes: 1 },
      existingMr: { iid: 482, title: 'Enable compiled bindings' },
    };
    invokeMock.mockResolvedValueOnce(answer);
    await expect(createTauriClient().gitMergeCheck('main')).resolves.toEqual(answer);
  });
});
