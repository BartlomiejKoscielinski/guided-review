import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { IpcError } from '../errors';

// F-26.1 in the mock backend, as the core answers `author_mr(project, iid)` (plan M7): my MR
// !480 as Author.dc.html shows it (the mock's two open threads and the one resolved earlier).
// Shapes (the core's AuthorMr in camelCase): `title`, `sourceBranch`, `targetBranch`, `pipeline`
// (the head pipeline as `pipelineGet` gives it, or null without one), `threads` (the unresolved
// threads in GitLab's order), `toAnswer` (unresolved threads whose last note isn't mine) and
// `resolved` ({ count, firstExcerpt }); a thread is { id, author (display name), avatar
// (initials), place ("file:line" or "General"), excerpt, kind ("question" | "change"), status
// ("changeRequested" | "question" | "fixProposed" | "fixedLocally" | "replied" | "answered") }.
//   Marta K.  UploadWorker.cs:46  Change requested
//   Piotr S.  UploadWorker.cs:36  Question
//   1 resolved earlier · typo in a log message

const PROJECT = 'mobile/mobile-app';
const MINE = 480;

async function backend(options: Parameters<typeof createMockClient>[0] = {}) {
  const mock = createMockClient({ latencyMs: 0, ...options });
  await mock.repoPick();
  return mock;
}

async function rejection(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IpcError) return error;
    throw error;
  }
  throw new Error('expected the call to reject');
}

describe('mock author_mr (F-26.1)', () => {
  it('F-26.1 authorMr gives the title, the branches and the passed pipeline of !480', async () => {
    const mock = await backend();

    const mr = await mock.authorMr(PROJECT, MINE);

    expect(mr).toMatchObject({
      title: 'Retry in UploadWorker after network loss',
      sourceBranch: 'feature/upload-retry',
      targetBranch: 'develop',
    });
    expect(mr.pipeline?.status).toBe('passed');
  });

  it('F-26.1 the threads are Marta K. at UploadWorker.cs:46 and Piotr S. at UploadWorker.cs:36, in that order', async () => {
    const mock = await backend();

    const { threads } = await mock.authorMr(PROJECT, MINE);

    expect(threads.map((t) => [t.author, t.avatar, t.place])).toEqual([
      ['Marta K.', 'MK', 'UploadWorker.cs:46'],
      ['Piotr S.', 'PS', 'UploadWorker.cs:36'],
    ]);
    expect(threads[0]?.excerpt).toBe(
      'The delay grows linearly. Can we make it exponential with a cap? With MaxAttempts raised later we’d hammer the API.',
    );
    expect(threads[1]?.excerpt).toBe(
      'What happens if the app is killed in the middle of retrying? Do we lose the attempt count?',
    );
  });

  it('F-26.1 the tags follow the rules: Marta’s thread is a change request, Piotr’s a question', async () => {
    const mock = await backend();

    const { threads } = await mock.authorMr(PROJECT, MINE);

    expect(threads.map((t) => [t.kind, t.status])).toEqual([
      ['change', 'changeRequested'],
      ['question', 'question'],
    ]);
  });

  it('F-26.1 two threads are to answer and one resolved earlier: "typo in a log message"', async () => {
    const mock = await backend();

    const mr = await mock.authorMr(PROJECT, MINE);

    expect(mr.toAnswer).toBe(2);
    expect(mr.resolved).toEqual({ count: 1, firstExcerpt: 'typo in a log message' });
  });

  it('F-26.1 a merge request that is not mine is INVALID_INPUT, an unknown one GITLAB_NOT_FOUND', async () => {
    const mock = await backend();

    expect((await rejection(mock.authorMr(PROJECT, 482))).code).toBe('INVALID_INPUT');
    expect((await rejection(mock.authorMr(PROJECT, 9999))).code).toBe('GITLAB_NOT_FOUND');
  });

  it('F-26.1 without a GitLab token authorMr answers GITLAB_UNAUTHORIZED before any other check', async () => {
    const mock = await backend({ gitlab: { state: 'noToken' } });

    expect((await rejection(mock.authorMr(PROJECT, MINE))).code).toBe('GITLAB_UNAUTHORIZED');
    expect((await rejection(mock.authorMr(PROJECT, 482))).code).toBe('GITLAB_UNAUTHORIZED');
  });
});
