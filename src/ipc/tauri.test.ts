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

  it('calls the GitLab commands by their contract names', async () => {
    const client = createTauriClient();
    await client.gitlabStatus(true);
    await client.gitlabAccountSave('https://gitlab.local', 'glpat-test0000');
    await client.gitlabAccountRemove();
    await client.gitlabListMrs('waiting');
    expect(invokeMock.mock.calls).toEqual([
      ['gitlab_status', { refresh: true }],
      ['gitlab_account_save', { server: 'https://gitlab.local', token: 'glpat-test0000' }],
      ['gitlab_account_remove', undefined],
      ['gitlab_list_mrs', { tab: 'waiting' }],
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
    await client.riderStatus();
    await client.riderPickExecutable();
    expect(invokeMock.mock.calls).toEqual([
      ['repo_active', undefined],
      ['repo_pick', undefined],
      ['git_status', undefined],
      ['git_commit_info', { sha: null }],
      ['git_commit_info', { sha: 'a3f9c12' }],
      ['git_file_diff', { source: { kind: 'local' }, file }],
      ['git_stage', { selection }],
      ['git_unstage', { selection }],
      ['git_commit', { message: 'Subject', amend: true, fixup: null, only: null }],
      ['git_last_message', undefined],
      ['git_push', undefined],
      ['rider_open', { file: 'a b/ż.cs', line: 12, session: null }],
      ['rider_status', undefined],
      ['rider_pick_executable', undefined],
    ]);
  });

  it('calls the repository list and source commands by their contract names', async () => {
    const client = createTauriClient();
    await client.repoList();
    await client.repoSwitch(2);
    await client.repoSetDefault(2);
    await client.repoRemove(2);
    await client.sourceDetect('!482');
    await client.gitLog();
    await client.gitLog('feature/zażółć', 'torch');
    await client.gitStatusSummary();
    await client.sessionOpenCommit({ from: '9be0d47', to: 'a3f9c12' });
    await client.sessionOpenLocal({ kind: 'branchVsTarget', target: 'origin/develop' });
    await client.sessionOpenBranch('develop');
    await client.sessionOpenRepo('C:\\Repos ąę\\mobile-app');
    expect(invokeMock.mock.calls).toEqual([
      ['repo_list', undefined],
      ['repo_switch', { id: 2 }],
      ['repo_set_default', { id: 2 }],
      ['repo_remove', { id: 2 }],
      ['source_detect', { input: '!482' }],
      ['git_log', { branch: null, query: null }],
      ['git_log', { branch: 'feature/zażółć', query: 'torch' }],
      ['git_status_summary', undefined],
      ['session_open_commit', { range: { from: '9be0d47', to: 'a3f9c12' } }],
      ['session_open_local', { scope: { kind: 'branchVsTarget', target: 'origin/develop' } }],
      ['session_open_branch', { branch: 'develop' }],
      ['session_open_repo', { path: 'C:\\Repos ąę\\mobile-app' }],
    ]);
  });

  it('F-06.5 a dragged order and a picked strategy go to the core by their contract names', async () => {
    const client = createTauriClient();
    await client.reviewReorderSteps('session-1', ['s2', 's1', 's3']);
    await client.reviewSetStrategy('session-1', 'testsFirst');
    expect(invokeMock.mock.calls).toEqual([
      ['review_reorder_steps', { session: 'session-1', order: ['s2', 's1', 's3'] }],
      ['review_set_strategy', { session: 'session-1', strategy: 'testsFirst' }],
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

  it('F-05.6 opens an MR with a progress channel, cancels it, and opens Rider from a session', async () => {
    const client = createTauriClient();
    const seen: unknown[] = [];
    await client.sessionOpenMr(482, 'mobile/mobile-app', 'task-1', (p) => seen.push(p));
    await client.sessionPrepareCancel('task-1');
    await client.riderOpen('src/A.cs', 3, 'session-1');
    const [open, cancel, rider] = invokeMock.mock.calls;
    expect(open?.[0]).toBe('session_open_mr');
    const args = open?.[1] as { ch: { onmessage: (m: unknown) => void } };
    expect(args).toMatchObject({ iid: 482, project: 'mobile/mobile-app', task: 'task-1' });
    args.ch.onmessage({ stage: 'creatingWorktree' });
    expect(seen).toEqual([{ stage: 'creatingWorktree' }]);
    expect(cancel).toEqual(['session_prepare_cancel', { task: 'task-1' }]);
    expect(rider).toEqual(['rider_open', { file: 'src/A.cs', line: 3, session: 'session-1' }]);
  });
});
