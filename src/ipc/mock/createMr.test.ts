import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { IpcClient } from '../client';

// F-27.6 in the mock backend, as the core answers `gitlab_create_mr(request)`: MR !483 of
// CreateMR.dc.html with the head pipeline #18361 running, a link on the mock server's project, the
// title as typed (with the core's `Draft: ` prefix when `draft`, not doubled), and the guards of
// the other S-11 commands (GitLab account first, then a target that is a branch on origin; a blank
// title is GitLab's 422 words "title can't be blank"). An open MR of the branch (the scenario
// 'guided-review.mock.mrChecks' existingMr, or the one just created) is CONFLICT with GitLab's
// words "Another open merge request already exists for this source branch: !<iid>", and after a
// create the checks name the new MR as the branch's open MR. Go to your MR needs `authorMr` to
// know !483: before the create it is GITLAB_NOT_FOUND, afterwards my MR with the created title,
// the branches of the repository (chore/compiled-bindings → the target), no threads and the
// pipeline #18361 running as its head.

const KEY = 'guided-review.mock.mrChecks';
const PROJECT = 'mobile/mobile-app';

type Request = Parameters<IpcClient['gitlabCreateMr']>[0];

const REQUEST: Request = {
  target: 'develop',
  title: 'Enable compiled bindings in app pages',
  description: '## What\nx',
  reviewerIds: [2, 3],
  draft: false,
  removeSourceBranch: true,
  squash: false,
};

function client(options: Parameters<typeof createMockClient>[0] = {}, scenario?: object) {
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
    ...options,
  });
}

describe('mock create MR (F-27.6)', () => {
  it('F-27.6 creates !483 with the title as typed, its link and the pipeline #18361 running', async () => {
    await expect(client().gitlabCreateMr(REQUEST)).resolves.toEqual({
      iid: 483,
      title: 'Enable compiled bindings in app pages',
      webUrl: 'https://gitlab.local/mobile/mobile-app/-/merge_requests/483',
      pipeline: { id: 18361, status: 'running' },
    });
  });

  it('F-27.6 a draft MR gets the Draft: prefix once, as the core does', async () => {
    const plain = await client().gitlabCreateMr({ ...REQUEST, draft: true });
    expect(plain.title).toBe('Draft: Enable compiled bindings in app pages');
    const typed = await client().gitlabCreateMr({
      ...REQUEST,
      draft: true,
      title: 'Draft: Enable compiled bindings in app pages',
    });
    expect(typed.title).toBe('Draft: Enable compiled bindings in app pages');
    const off = await client().gitlabCreateMr({ ...REQUEST, title: 'Draft: mine' });
    expect(off.title).toBe('Draft: mine');
  });

  it('F-27.6 a blank title is refused with the words of GitLab', async () => {
    await expect(client().gitlabCreateMr({ ...REQUEST, title: '  ' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: "title can't be blank",
    });
  });

  it('F-27.6 a target that is no branch on origin is INVALID_INPUT, like the other S-11 commands', async () => {
    await expect(
      client().gitlabCreateMr({ ...REQUEST, target: 'nie-ma-takiej' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('F-27.6 without a GitLab token it is GITLAB_UNAUTHORIZED', async () => {
    const mock = client({ gitlab: { state: 'noToken' } });
    await expect(mock.gitlabCreateMr(REQUEST)).rejects.toMatchObject({
      code: 'GITLAB_UNAUTHORIZED',
    });
  });

  it('F-27.6 a branch that already has an open MR is a CONFLICT with the words of GitLab', async () => {
    const mock = client({}, { existingMr: { iid: 482, title: 'Enable compiled bindings' } });
    const error: unknown = await mock.gitlabCreateMr(REQUEST).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'CONFLICT' });
    expect((error as Error).message).toContain(
      'Another open merge request already exists for this source branch',
    );
  });

  it('F-27.6 the created MR is the open MR of the branch: the checks name it and a second create is a CONFLICT', async () => {
    const mock = client();
    expect((await mock.gitMergeCheck()).existingMr).toBeUndefined();
    await mock.gitlabCreateMr(REQUEST);
    expect((await mock.gitMergeCheck()).existingMr).toEqual({
      iid: 483,
      title: 'Enable compiled bindings in app pages',
    });
    await expect(mock.gitlabCreateMr(REQUEST)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('F-27.6 !483 is no MR of the mock before it is created, and my MR with the created title afterwards', async () => {
    const mock = client();
    await expect(mock.authorMr(PROJECT, 483)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
    await mock.gitlabCreateMr({ ...REQUEST, target: 'main' });
    const mr = await mock.authorMr(PROJECT, 483);
    expect(mr).toMatchObject({
      iid: 483,
      title: 'Enable compiled bindings in app pages',
      sourceBranch: 'chore/compiled-bindings',
      targetBranch: 'main',
      threads: [],
      toAnswer: 0,
      pipeline: { number: 18361, status: 'running' },
    });
  });
});
