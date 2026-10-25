import { describe, expect, it } from 'vitest';
import { IpcError } from '../errors';
import { createMockClient } from '.';

// F-20.9 in the mock backend, as the core answers `job_details(project, iid, job)` (plan M6,
// decision 15): the client call is `jobDetails(project, iid, job)` -> `{ retriedSameFailure }`.
// Pipeline.dc.html shows "Retried: failed again on the same test." for ui-tests:android, whose
// retry fails again (the UI test waits for the old id and times out every time). In the mock data
// that is job 1834205 of #18342 (ids are `<pipeline><index>`: unit-tests 1834204,
// ui-tests:android 1834205); every other job reads false.

const PROJECT = 'mobile/mobile-app';
const IID = 482;

async function backend() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  return mock;
}

describe('mock job details (F-20.9)', () => {
  it('F-20.9 ui-tests:android of #18342 failed again on the same test', async () => {
    const mock = await backend();

    expect(await mock.jobDetails(PROJECT, IID, 1834205)).toEqual({ retriedSameFailure: true });
  });

  it('F-20.9 other jobs did not fail again on the same test', async () => {
    const mock = await backend();

    expect(await mock.jobDetails(PROJECT, IID, 1834204)).toEqual({ retriedSameFailure: false });
    expect(await mock.jobDetails(PROJECT, IID, 1832104)).toEqual({ retriedSameFailure: false });
  });

  it('F-20.9 an unknown job is GitLab not finding it', async () => {
    const mock = await backend();

    const err: unknown = await mock.jobDetails(PROJECT, IID, 42).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(IpcError);
    expect(err).toMatchObject({ code: 'GITLAB_NOT_FOUND' });
  });
});
