import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-27.1: the branch block of S-11 in the mock backend, with the numbers of CreateMR.dc.html
// (chore/compiled-bindings → develop, 3 commits · 12 files · +84 −40). The other targets answer
// with numbers of their own so that the target switch is visible in dev:mock.

const client = () => createMockClient({ latencyMs: 0 });

describe('mock branch info (F-27.1)', () => {
  it('F-27.1 answers the CreateMR mock: the current branch, develop, 3 commits · 12 files · +84 −40', async () => {
    const info = await client().gitBranchInfo();
    expect(info.branch).toBe('chore/compiled-bindings');
    expect(info.target).toBe('develop');
    expect(info.targets).toEqual(['develop', 'main', 'release/1.8']);
    expect([info.commits, info.files, info.additions, info.deletions]).toEqual([3, 12, 84, 40]);
  });

  it('F-27.1 another target is recomputed, the target list stays the same', async () => {
    const ipc = client();
    const main = await ipc.gitBranchInfo('main');
    expect(main.target).toBe('main');
    expect(main.targets).toEqual(['develop', 'main', 'release/1.8']);
    expect([main.commits, main.files, main.additions, main.deletions]).toEqual([7, 21, 190, 88]);
    const release = await ipc.gitBranchInfo('release/1.8');
    expect(release.target).toBe('release/1.8');
    expect(release.commits).toBeGreaterThan(0);
    // The explicit default is the default.
    expect(await ipc.gitBranchInfo('develop')).toEqual(await ipc.gitBranchInfo());
  });

  it('F-27.1 refuses a target that is no branch on origin, like the core', async () => {
    await expect(client().gitBranchInfo('nie-ma-takiej')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});
