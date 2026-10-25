import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { IpcError } from '../errors';
import type { IpcClient } from '../client';

// F-20.4 in the mock backend, as the core answers `pipeline_retry(project, iid, id)` (Retry failed
// jobs), `pipeline_cancel(project, iid, id)` (Cancel pipeline) and `os_open_gitlab_url(url)`
// (Open in GitLab), and as `pipeline_get` now carries the pipeline's `webUrl` (Pipeline.dc.html,
// M6 decisions 6 and 13). Both pipeline writes answer with the pipeline's head as it now is.
//
//  - Retry failed jobs: every failed, failed-allowed and canceled job of the pipeline gets a new
//    attempt (new id, state running, action cancel); passed, skipped and manual jobs are kept as
//    they are. The pipeline reads Running afterwards, in its head and in its tab.
//  - Cancel pipeline: every running and waiting job becomes canceled (action retry); passed,
//    skipped and manual jobs are kept. The pipeline reads Canceled afterwards.
//  - The pipelines of !482 have `webUrl` = `https://gitlab.local/mobile/mobile-app/-/pipelines/<id>`
//    (the mock GitLab server and the mock project); the new #18351 too.
//  - An unknown pipeline or another MR is GitLab's 404 ("GitLab didn't find it.").
//  - `osOpenGitlabUrl` opens nothing in the mock and answers; like the core it refuses a URL that
//    is not `https` on the mock GitLab host (an IpcError).

const PROJECT = 'mobile/mobile-app';
const IID = 482;
const URL_OF = (id: number) => `https://gitlab.local/${PROJECT}/-/pipelines/${String(id)}`;

type Column = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number];
type Row = Column['jobs'][number];

async function backend() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  return mock;
}

const flat = (columns: Column[]): Row[] => columns.flatMap((c) => c.jobs);
const job = (columns: Column[], name: string): Row => {
  const found = flat(columns).find((j) => j.name === name);
  if (!found) throw new Error(`no job ${name}`);
  return found;
};

describe('mock pipeline web URLs (F-20.4)', () => {
  it('F-20.4 the heads of !482’s pipelines carry their GitLab page', async () => {
    const mock = await backend();

    for (const id of [18342, 18321, 18320]) {
      expect((await mock.pipelineGet(PROJECT, IID, id)).webUrl).toBe(URL_OF(id));
    }
  });

  it('F-20.4 the new pipeline #18351 carries its page too', async () => {
    const mock = await backend();
    await mock.pipelineRunMr(PROJECT, IID);

    expect((await mock.pipelineGet(PROJECT, IID, 18351)).webUrl).toBe(URL_OF(18351));
  });
});

describe('mock Retry failed jobs (F-20.4)', () => {
  it('F-20.4 retrying the failed #18321 answers its head as Running, with its page and number', async () => {
    const mock = await backend();

    const head = await mock.pipelineRetry(PROJECT, IID, 18321);

    expect(head).toMatchObject({ status: 'running', number: 18321, webUrl: URL_OF(18321) });
    expect((await mock.pipelineGet(PROJECT, IID, 18321)).status).toBe('running');
    const tab = (await mock.pipelineList(PROJECT, IID)).find((t) => t.id === 18321);
    expect(tab?.status).toBe('running');
  });

  it('F-20.4 retrying #18321 gives the failed unit-tests a new running attempt and keeps every other job', async () => {
    const mock = await backend();
    const before = await mock.pipelineJobs(PROJECT, IID, 18321);

    await mock.pipelineRetry(PROJECT, IID, 18321);

    const after = await mock.pipelineJobs(PROJECT, IID, 18321);
    const retried = job(after, 'unit-tests');
    expect(retried.id).not.toBe(job(before, 'unit-tests').id);
    expect(retried).toMatchObject({ state: 'running', action: 'cancel' });
    for (const row of flat(before).filter((j) => j.name !== 'unit-tests')) {
      expect(job(after, row.name), row.name).toEqual(row);
    }
    expect(job(after, 'sonar').state).toBe('skipped');
  });

  it('F-20.4 retrying the canceled #18320 restarts all its canceled jobs and leaves restore passed', async () => {
    const mock = await backend();
    const before = await mock.pipelineJobs(PROJECT, IID, 18320);

    const head = await mock.pipelineRetry(PROJECT, IID, 18320);

    expect(head.status).toBe('running');
    const after = await mock.pipelineJobs(PROJECT, IID, 18320);
    expect(job(after, 'restore')).toEqual(job(before, 'restore'));
    for (const row of flat(after).filter((j) => j.name !== 'restore')) {
      expect(row, row.name).toMatchObject({ state: 'running', action: 'cancel' });
    }
    expect(flat(after).map((j) => j.id)).toHaveLength(new Set(flat(after).map((j) => j.id)).size);
  });

  it('F-20.4 retrying #18342 restarts its allowed failure, keeps the manual jobs, and the pipeline is no longer Passed', async () => {
    const mock = await backend();

    const head = await mock.pipelineRetry(PROJECT, IID, 18342);

    expect(head.status).toBe('running');
    expect(head.allowedFailures).toBe(0);
    const after = await mock.pipelineJobs(PROJECT, IID, 18342);
    expect(job(after, 'ui-tests:android')).toMatchObject({ state: 'running', action: 'cancel' });
    expect(job(after, 'ui-tests:ios-device').state).toBe('manual');
    expect(job(after, 'distribute:qa').state).toBe('manual');
    expect(job(after, 'build:android').state).toBe('passed');
  });

  it('F-20.4 retrying one pipeline leaves the others as they were', async () => {
    const mock = await backend();

    await mock.pipelineRetry(PROJECT, IID, 18321);

    expect((await mock.pipelineGet(PROJECT, IID, 18342)).status).toBe('passed');
    expect((await mock.pipelineGet(PROJECT, IID, 18320)).status).toBe('canceled');
    expect(job(await mock.pipelineJobs(PROJECT, IID, 18320), 'build:android').state).toBe(
      'canceled',
    );
  });

  it('F-20.4 an unknown pipeline or another MR is GitLab’s 404', async () => {
    const mock = await backend();

    await expect(mock.pipelineRetry(PROJECT, IID, 999)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
    await expect(mock.pipelineRetry(PROJECT, 7, 18321)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
  });
});

describe('mock Cancel pipeline (F-20.4)', () => {
  it('F-20.4 canceling the new #18351 answers its head as Canceled and cancels the running and waiting jobs', async () => {
    const mock = await backend();
    await mock.pipelineRunMr(PROJECT, IID);

    const head = await mock.pipelineCancel(PROJECT, IID, 18351);

    expect(head).toMatchObject({ status: 'canceled', number: 18351, webUrl: URL_OF(18351) });
    expect((await mock.pipelineGet(PROJECT, IID, 18351)).status).toBe('canceled');
    const tab = (await mock.pipelineList(PROJECT, IID)).find((t) => t.id === 18351);
    expect(tab?.status).toBe('canceled');
    const jobs = await mock.pipelineJobs(PROJECT, IID, 18351);
    expect(job(jobs, 'build:android')).toMatchObject({ state: 'canceled', action: 'retry' });
    expect(job(jobs, 'sonar')).toMatchObject({ state: 'canceled', action: 'retry' });
    expect(job(jobs, 'distribute:qa').state).toBe('manual');
    expect(job(jobs, 'ui-tests:ios-device').state).toBe('manual');
  });

  it('F-20.4 a pipeline that was just retried can be canceled again', async () => {
    const mock = await backend();
    await mock.pipelineRetry(PROJECT, IID, 18321);

    const head = await mock.pipelineCancel(PROJECT, IID, 18321);

    expect(head.status).toBe('canceled');
    const jobs = await mock.pipelineJobs(PROJECT, IID, 18321);
    expect(job(jobs, 'unit-tests')).toMatchObject({ state: 'canceled', action: 'retry' });
    expect(job(jobs, 'build:android').state).toBe('passed');
    expect(job(jobs, 'sonar').state).toBe('skipped');
  });

  it('F-20.4 an unknown pipeline or another MR is GitLab’s 404', async () => {
    const mock = await backend();

    await expect(mock.pipelineCancel(PROJECT, IID, 999)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
    await expect(mock.pipelineCancel(PROJECT, 7, 18351)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
  });
});

describe('mock Open in GitLab (F-20.4)', () => {
  it('F-20.4 a pipeline page on the mock GitLab host opens (nothing happens in the mock)', async () => {
    const mock = await backend();

    await expect(mock.osOpenGitlabUrl(URL_OF(18342))).resolves.toBeUndefined();
  });

  it('F-20.4 like the core, a URL that is not https on the GitLab host is refused', async () => {
    const mock = await backend();

    for (const url of [
      'http://gitlab.local/mobile/mobile-app/-/pipelines/1',
      'https://evil.example/x',
      'https://gitlab.local/a b',
    ]) {
      await expect(mock.osOpenGitlabUrl(url), url).rejects.toBeInstanceOf(IpcError);
    }
  });
});
