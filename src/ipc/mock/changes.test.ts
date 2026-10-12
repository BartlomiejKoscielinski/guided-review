import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

const client = (changes = {}) => createMockClient({ latencyMs: 0, changes });

describe('mock S-06 backend', () => {
  it('starts with the Changes mock: 100 files, 80 in the commit', async () => {
    const status = await client().gitStatus();
    expect(status.totalFiles).toBe(100);
    expect(status.stagedFiles).toBe(80);
    expect(status.branch).toBe('chore/compiled-bindings');
    expect(status.groups.map((g) => g.dir)).toContain('src/App/Views/Deliveries');
  });

  it('stages and unstages lines of a file', async () => {
    const ipc = client();
    const file = { path: 'docs/compiled-bindings.md', untracked: false };
    await ipc.gitStage({ kind: 'lines', file, lines: [{ side: 'new', no: 1 }] });
    let diff = await ipc.gitFileDiff({ kind: 'local' }, file);
    const staged = diff.hunks[0]?.lines.filter((l) => l.staged).map((l) => l.newNo);
    expect(staged).toEqual([1]);
    await ipc.gitUnstage({ kind: 'lines', file, lines: [{ side: 'new', no: 1 }] });
    diff = await ipc.gitFileDiff({ kind: 'local' }, file);
    expect(diff.hunks[0]?.lines.some((l) => l.staged)).toBe(false);
  });

  it('commits what is staged; the rest stays', async () => {
    const ipc = client();
    const done = await ipc.gitCommit('Enable compiled bindings in app pages', false);
    expect(done.shortSha).toBe('7c1e2a9');
    const status = await ipc.gitStatus();
    expect(status.totalFiles).toBe(20);
    expect(status.stagedFiles).toBe(0);
    await expect(ipc.gitLastMessage()).resolves.toBe('Enable compiled bindings in app pages');
  });

  it('scenarios: no repository, clean tree, hook failure, rejected push', async () => {
    await expect(client({ noRepo: true }).repoActive()).resolves.toBeNull();
    await expect(client({ noRepo: true }).gitStatus()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect((await client({ clean: true }).gitStatus()).totalFiles).toBe(0);
    await expect(client({ commitFails: 'hook' }).gitCommit('x', false)).rejects.toMatchObject({
      message: 'Commit failed. A hook rejected it.',
    });
    await expect(client({ pushFails: 'rejected' }).gitPush()).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await client({ files: 1000 }).gitStatus()).totalFiles).toBe(1000);
  });

  it('commit mode: a3f9c12 with three files', async () => {
    const info = await client().gitCommitInfo();
    expect(info.shortSha).toBe('a3f9c12');
    expect(info.totalFiles).toBe(3);
    const diff = await client().gitFileDiff(
      { kind: 'commit', sha: info.sha },
      { path: 'src/Infrastructure/Workers/UploadWorker.cs', untracked: false },
    );
    expect([diff.additions, diff.deletions]).toEqual([8, 1]);
  });
});
