import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

const client = (changes = {}) => createMockClient({ latencyMs: 0, changes });

describe('mock repositories (F-19.6, F-30.7)', () => {
  it('F-30.7 lists two repositories and switches the active one', async () => {
    const ipc = client();
    const repos = await ipc.repoList();
    expect(repos.map((r) => [r.name, r.isDefault, r.isActive])).toEqual([
      ['mobile-app', true, true],
      ['courier-api', false, false],
    ]);
    await expect(ipc.repoSwitch(2)).resolves.toEqual({
      name: 'courier-api',
      path: 'C:\\src\\courier-api',
    });
    await expect(ipc.repoActive()).resolves.toMatchObject({ name: 'courier-api' });
    await expect(ipc.repoSwitch(9)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('F-19.6 sets the default, removes, and the first added becomes default', async () => {
    const ipc = client();
    await ipc.repoSetDefault(2);
    await ipc.repoRemove(2);
    expect((await ipc.repoList()).map((r) => [r.id, r.isDefault])).toEqual([[1, true]]);
    const empty = client({ noRepo: true });
    expect(await empty.repoList()).toEqual([]);
    await empty.repoPick();
    const [first] = await empty.repoList();
    expect(first).toMatchObject({ name: 'mobile-app', isDefault: true, isActive: true });
    expect(first?.worktreeRoot).toBe('C:\\src\\.review');
  });
});

describe('mock source detection (F-01.1, F-01.5)', () => {
  it('F-01.1 detects MR URL, !iid, SHA, branch and path', async () => {
    const ipc = client();
    await expect(
      ipc.sourceDetect('https://gitlab.local/mobile/mobile-app/-/merge_requests/482'),
    ).resolves.toEqual({ kind: 'mr', project: 'mobile/mobile-app', iid: 482, repoId: 1 });
    await expect(
      ipc.sourceDetect('https://gitlab.local/mobile/courier-api/-/merge_requests/7/diffs'),
    ).resolves.toMatchObject({ kind: 'mr', repoId: 2 });
    await expect(ipc.sourceDetect('!482')).resolves.toMatchObject({ kind: 'mr', iid: 482 });
    await expect(ipc.sourceDetect('a3f9c12')).resolves.toMatchObject({
      kind: 'commit',
      shortSha: 'a3f9c12',
    });
    await expect(ipc.sourceDetect('chore/compiled-bindings')).resolves.toMatchObject({
      kind: 'branch',
      current: true,
    });
    await expect(ipc.sourceDetect('origin/develop')).resolves.toMatchObject({
      kind: 'branch',
      remote: true,
    });
    await expect(ipc.sourceDetect('"C:\\src\\mobile-app\\src"')).resolves.toMatchObject({
      kind: 'repository',
      repoId: 1,
    });
    await expect(ipc.sourceDetect('  ')).resolves.toBeNull();
  });

  it('F-01.5 errors carry the spec copy', async () => {
    const ipc = client();
    await expect(ipc.sourceDetect('nope')).rejects.toMatchObject({
      message: 'No commit, branch or repository matches “nope”.',
    });
    await expect(
      ipc.sourceDetect('https://gitlab.other.org/mobile/x/-/merge_requests/1'),
    ).rejects.toMatchObject({ message: 'gitlab.other.org is not the configured GitLab server.' });
    await expect(
      ipc.sourceDetect('https://gitlab.local/mobile/x/-/merge_requests/1'),
    ).rejects.toMatchObject({
      message: 'mobile/x is not one of your repositories. Add it in Settings › GitLab.',
    });
  });
});

describe('mock commits, scopes and sessions (F-03.1, F-03.3, F-01.3)', () => {
  it('F-03.1 lists the Start mock commits and filters by message, author or SHA', async () => {
    const ipc = client();
    const all = await ipc.gitLog();
    expect(all.branch).toBe('chore/compiled-bindings');
    expect(all.commits.map((c) => c.shortSha)).toEqual([
      'a3f9c12',
      '9be0d47',
      '51c2e8a',
      'e07d3f1',
      'c4a19b0',
    ]);
    expect((await ipc.gitLog(undefined, 'offline')).commits).toHaveLength(2);
    expect((await ipc.gitLog(undefined, 'paweł')).commits).toHaveLength(1);
    expect((await ipc.gitLog(undefined, '51c2')).commits[0]?.shortSha).toBe('51c2e8a');
  });

  it('F-03.3 counts the three scopes like the Start mock', async () => {
    const summary = await client().gitStatusSummary();
    expect(summary.targetName).toBe('develop');
    expect(summary.uncommitted).toEqual({ files: 100, additions: 318, deletions: 142 });
    expect(summary.staged.files).toBe(12);
    expect(summary.branchVsTarget).toEqual({ commits: 3, files: 104 });
  });

  it('F-01.3 opens commit and local sessions on their stub screens', async () => {
    const ipc = client();
    const commit = await ipc.sessionOpenCommit({ to: 'a3f9c12' });
    expect(commit.route).toEqual({ screen: 'S-03', sessionId: commit.sessionId });
    const local = await ipc.sessionOpenLocal({ kind: 'uncommitted' });
    expect(local.route).toEqual({ screen: 'S-02', sessionId: local.sessionId });
    expect((await ipc.sessionOpenBranch('develop')).route.screen).toBe('S-03');
    expect((await ipc.sessionOpenBranch('chore/compiled-bindings')).route.screen).toBe('S-02');
    await ipc.sessionOpenRepo('C:\\src\\Zażółć gęślą');
    await expect(ipc.repoActive()).resolves.toMatchObject({ name: 'Zażółć gęślą' });
    await expect(ipc.sessionOpenCommit({ to: 'ffffff0' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});
