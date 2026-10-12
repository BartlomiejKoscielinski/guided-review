import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTauriClient } from './tauri';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

describe('Tauri IPC client', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it('calls app_health', async () => {
    invokeMock.mockResolvedValue({ version: '0.1.0', platform: 'windows' });
    await expect(createTauriClient().appHealth()).resolves.toEqual({
      version: '0.1.0',
      platform: 'windows',
    });
    expect(invokeMock).toHaveBeenCalledWith('app_health', undefined);
  });

  it('calls the settings, start-route and sessions commands by their contract names', async () => {
    const client = createTauriClient();
    await client.appSettingsGet();
    await client.appSettingsSet({ ui: { startIn: 'detailed' } });
    await client.appStartRoute();
    await client.sessionsListUnfinished();
    expect(invokeMock.mock.calls).toEqual([
      ['app_settings_get', undefined],
      ['app_settings_set', { patch: { ui: { startIn: 'detailed' } } }],
      ['app_start_route', undefined],
      ['sessions_list_unfinished', undefined],
    ]);
  });

  it('calls the repository and git commands by their contract names', async () => {
    const client = createTauriClient();
    const file = { path: 'a b/ż.cs', untracked: false };
    const selection = { kind: 'lines' as const, file, lines: [{ side: 'new' as const, no: 3 }] };
    await client.repoActive();
    await client.repoPick();
    await client.gitStatus();
    await client.gitCommitInfo();
    await client.gitCommitInfo('a3f9c12');
    await client.gitFileDiff({ kind: 'local' }, file);
    await client.gitStage(selection);
    await client.gitUnstage(selection);
    await client.gitCommit('Subject', true);
    await client.gitLastMessage();
    await client.gitPush();
    await client.riderOpen('a b/ż.cs', 12);
    expect(invokeMock.mock.calls).toEqual([
      ['repo_active', undefined],
      ['repo_pick', undefined],
      ['git_status', undefined],
      ['git_commit_info', { sha: null }],
      ['git_commit_info', { sha: 'a3f9c12' }],
      ['git_file_diff', { source: { kind: 'local' }, file }],
      ['git_stage', { selection }],
      ['git_unstage', { selection }],
      ['git_commit', { message: 'Subject', amend: true }],
      ['git_last_message', undefined],
      ['git_push', undefined],
      ['rider_open', { file: 'a b/ż.cs', line: 12 }],
    ]);
  });

  it('rejects with an IpcError carrying the AppError', async () => {
    invokeMock.mockRejectedValue({ code: 'INTERNAL', message: 'Broken.', retryable: false });
    await expect(createTauriClient().appHealth()).rejects.toMatchObject({
      name: 'IpcError',
      code: 'INTERNAL',
      message: 'Broken.',
    });
  });
});
