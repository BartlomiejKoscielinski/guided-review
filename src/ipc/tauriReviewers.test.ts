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

// F-27.3: the reviewers of S-11 call `reviewers_suggest` (target or null for the default, like
// `git_branch_info`) and `gitlab_users_search` (the typed text), and return what the core sends.
describe('Tauri IPC client reviewers (F-27.3)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
  });

  it('F-27.3 calls reviewers_suggest and gitlab_users_search by their contract names', async () => {
    const client = createTauriClient();
    await client.reviewersSuggest();
    await client.reviewersSuggest('main');
    await client.gitlabUsersSearch('Żółć');
    expect(invokeMock.mock.calls).toEqual([
      ['reviewers_suggest', { target: null }],
      ['reviewers_suggest', { target: 'main' }],
      ['gitlab_users_search', { query: 'Żółć' }],
    ]);
  });

  it('F-27.3 hands the answers of the core on unchanged', async () => {
    const suggestion = {
      id: 2,
      username: 'marta.k',
      name: 'Marta K.',
      reason: 'Code owner of src/App/Views/',
    };
    invokeMock.mockResolvedValueOnce([suggestion]);
    await expect(createTauriClient().reviewersSuggest()).resolves.toEqual([suggestion]);
    const found = [{ username: 'anna.k', name: 'Anna K.' }];
    invokeMock.mockResolvedValueOnce(found);
    await expect(createTauriClient().gitlabUsersSearch('anna')).resolves.toEqual(found);
  });
});
