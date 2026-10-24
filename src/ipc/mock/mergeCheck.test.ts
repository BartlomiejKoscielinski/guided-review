import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-27.5: "Before you create" of S-11 in the mock backend, with the checks of CreateMR.dc.html
// (chore/compiled-bindings → develop: pushed, no conflicts, 6 of 6 steps · 0 open notes; into
// main: conflicts in MauiProgram.cs and App.xaml, in the order the mock lists them). A scenario
// under the storage key 'guided-review.mock.mrChecks' ({ pushed?, selfReview? (null = none),
// existingMr? }) makes the other states visible in dev:mock and e2e; Push (gitPush) turns the
// branch to pushed.

const KEY = 'guided-review.mock.mrChecks';

function client(scenario?: object) {
  const store = new Map<string, string>();
  if (scenario !== undefined) store.set(KEY, JSON.stringify(scenario));
  return createMockClient({
    latencyMs: 0,
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
}

describe('mock merge check (F-27.5)', () => {
  it('F-27.5 answers the CreateMR mock for develop: pushed, no conflicts, 6 of 6 steps, 0 open notes', async () => {
    const check = await client().gitMergeCheck();
    expect(check).toEqual({
      branch: 'chore/compiled-bindings',
      target: 'develop',
      pushed: 'pushed',
      conflicts: [],
      selfReview: { reviewed: 6, total: 6, notes: 0 },
    });
    expect(await client().gitMergeCheck('develop')).toEqual(check);
  });

  it('F-27.5 main conflicts in MauiProgram.cs and App.xaml, release/1.8 is clean', async () => {
    const ipc = client();
    const main = await ipc.gitMergeCheck('main');
    expect(main.target).toBe('main');
    expect(main.conflicts).toEqual(['MauiProgram.cs', 'App.xaml']);
    const release = await ipc.gitMergeCheck('origin/release/1.8');
    expect(release.target).toBe('release/1.8');
    expect(release.conflicts).toEqual([]);
  });

  it('F-27.5 refuses a target that is no branch on origin, like the core', async () => {
    await expect(client().gitMergeCheck('nie-ma-takiej')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('F-27.5 the scenario can leave the branch unpushed, and a push pushes it', async () => {
    const ipc = client({ pushed: 'notPushed' });
    expect((await ipc.gitMergeCheck()).pushed).toBe('notPushed');
    await ipc.gitPush();
    expect((await ipc.gitMergeCheck()).pushed).toBe('pushed');
  });

  it('F-27.5 the scenario can put the branch ahead of origin', async () => {
    expect((await client({ pushed: 'ahead' }).gitMergeCheck()).pushed).toBe('ahead');
  });

  it('F-27.5 the scenario can drop the self-review or give another one', async () => {
    const none = await client({ selfReview: null }).gitMergeCheck();
    expect(none.selfReview).toBeUndefined();
    const partial = await client({
      selfReview: { reviewed: 4, total: 6, notes: 2 },
    }).gitMergeCheck();
    expect(partial.selfReview).toEqual({ reviewed: 4, total: 6, notes: 2 });
  });

  it('F-27.5 the scenario can name an open MR of the branch', async () => {
    const found = await client({
      existingMr: { iid: 482, title: 'Enable compiled bindings' },
    }).gitMergeCheck();
    expect(found.existingMr).toEqual({ iid: 482, title: 'Enable compiled bindings' });
    expect((await client().gitMergeCheck()).existingMr).toBeUndefined();
  });
});
