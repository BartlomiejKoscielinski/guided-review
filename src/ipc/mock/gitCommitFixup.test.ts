import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-26.4: the mock's `gitCommit(message, amend, fixup, only)` stands in for the core's
// `git_commit` with a pathspec (M7 decision 10): only the listed files go into the commit, the
// rest of the staged changes stays staged, and nothing needs to be staged for the listed file
// (it is committed from the working tree). A fixup target is a commit SHA, never an option, like
// the core's `GitError::Invalid` (T5).

const PATH = 'src/App/Workers/UploadWorker.cs';
const SHA = 'b71e3a0c4d5e6f708192a3b4c5d6e7f8091a2b3c';

const client = (changes = {}) => createMockClient({ latencyMs: 0, changes });

describe('mock gitCommit with a fixup target and a file list (F-26.4)', () => {
  it('F-26.4 commits the listed file without anything being staged and answers with the new commit', async () => {
    const ipc = client({ clean: true });

    const done = await ipc.gitCommit('Address review on UploadWorker.cs:46', false, SHA, [PATH]);

    expect(done.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(done.sha.startsWith(done.shortSha)).toBe(true);
    expect(done.shortSha.length).toBeGreaterThanOrEqual(7);
  });

  it('F-26.4 the other staged changes of the mock repository stay staged', async () => {
    const ipc = client();
    const before = await ipc.gitStatus();

    await ipc.gitCommit('Fix', false, SHA, [PATH]);

    const after = await ipc.gitStatus();
    expect(after.stagedFiles).toBe(before.stagedFiles);
    expect(after.totalFiles).toBe(before.totalFiles);
  });

  it('F-26.4 a plain commit of the listed file needs no fixup target', async () => {
    const done = await client({ clean: true }).gitCommit('Fix', false, undefined, [PATH]);

    expect(done.shortSha).toBeTruthy();
  });

  it('F-26.4 refuses an empty message, a fixup that is not a sha, and reports a rejecting hook', async () => {
    await expect(client().gitCommit('  ', false, SHA, [PATH])).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Write a commit message first.',
    });
    await expect(client().gitCommit('Fix', false, '--amend', [PATH])).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(
      client({ commitFails: 'hook' }).gitCommit('Fix', false, SHA, [PATH]),
    ).rejects.toMatchObject({ code: 'GIT_FAILED', message: 'Commit failed. A hook rejected it.' });
  });

  it('F-26.4 without a file list the mock still commits only what is staged (S-06 unchanged)', async () => {
    const ipc = client();

    await ipc.gitCommit('Enable compiled bindings in app pages', false);

    const status = await ipc.gitStatus();
    expect(status.stagedFiles).toBe(0);
    expect(status.totalFiles).toBe(20);
    await expect(client({ clean: true }).gitCommit('x', false)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Nothing is staged for this commit.',
    });
  });
});
