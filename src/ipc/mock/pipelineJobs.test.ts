import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { IpcClient } from '../client';

// F-20.2 in the mock backend, as the core answers `pipeline_jobs(project, iid, pipeline)`,
// `job_retry(project, iid, job)` and `job_cancel(project, iid, job)` (plan M6, decisions 5 and 6):
// the jobs of !482's three pipelines as Pipeline.dc.html lists them. The stages run build, test,
// quality, distribute; the stage names are compared without case (GitLab's own are lower case, the
// screen shows them upper case). Row shape: { id, name, state, action, durationSecs }.
//
//   #18342  restore 0:48, build:android 6:12, build:ios 7:40 | unit-tests 1:52, ui-tests:android
//           3:05 (failed, allowed to fail), ui-tests:ios-device (manual) | dotnet-format 0:22,
//           sonar 2:10 | distribute:qa (manual)
//   #18321  as #18342, but unit-tests failed; ui-tests:android passed; ui-tests:ios-device,
//           dotnet-format, sonar and distribute:qa skipped
//   #18320  restore passed; every other job canceled

const PROJECT = 'mobile/mobile-app';
const IID = 482;

type Column = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number];
type Row = Column['jobs'][number];

async function backend() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  return mock;
}

const flat = (columns: Column[]): Row[] => columns.flatMap((c) => c.jobs);
const byName = (columns: Column[], name: string): Row => {
  const found = flat(columns).find((j) => j.name === name);
  if (!found) throw new Error(`no job ${name}`);
  return found;
};

describe('mock pipeline jobs (F-20.2)', () => {
  it('F-20.2 #18342 has the four stages of the mock with their jobs in order', async () => {
    const mock = await backend();

    const columns = await mock.pipelineJobs(PROJECT, IID, 18342);

    expect(columns.map((c) => c.name.toLowerCase())).toEqual([
      'build',
      'test',
      'quality',
      'distribute',
    ]);
    expect(columns.map((c) => c.jobs.map((j) => j.name))).toEqual([
      ['restore', 'build:android', 'build:ios'],
      ['unit-tests', 'ui-tests:android', 'ui-tests:ios-device'],
      ['dotnet-format', 'sonar'],
      ['distribute:qa'],
    ]);
  });

  it('F-20.2 #18342 rows carry the state, the one action and the duration of the mock', async () => {
    const mock = await backend();

    const columns = await mock.pipelineJobs(PROJECT, IID, 18342);

    const expected: [string, Row['state'], Row['action'], number | null][] = [
      ['restore', 'passed', null, 48],
      ['build:android', 'passed', null, 372],
      ['build:ios', 'passed', null, 460],
      ['unit-tests', 'passed', null, 112],
      ['ui-tests:android', 'failedAllowed', 'retry', 185],
      ['ui-tests:ios-device', 'manual', 'run', null],
      ['dotnet-format', 'passed', null, 22],
      ['sonar', 'passed', null, 130],
      ['distribute:qa', 'manual', 'run', null],
    ];
    for (const [name, state, action, durationSecs] of expected) {
      expect(byName(columns, name), name).toMatchObject({ state, action, durationSecs });
    }
  });

  it('F-20.2 #18321 has the failed unit-tests with Retry and the later jobs skipped without a button', async () => {
    const mock = await backend();

    const columns = await mock.pipelineJobs(PROJECT, IID, 18321);

    expect(byName(columns, 'unit-tests')).toMatchObject({
      state: 'failed',
      action: 'retry',
      durationSecs: 112,
    });
    expect(byName(columns, 'ui-tests:android')).toMatchObject({ state: 'passed', action: null });
    for (const name of ['ui-tests:ios-device', 'dotnet-format', 'sonar', 'distribute:qa']) {
      expect(byName(columns, name), name).toMatchObject({ state: 'skipped', action: null });
    }
    for (const name of ['restore', 'build:android', 'build:ios']) {
      expect(byName(columns, name), name).toMatchObject({ state: 'passed', action: null });
    }
  });

  it('F-20.2 #18320 has restore passed and every other job canceled with Retry and no duration', async () => {
    const mock = await backend();

    const columns = await mock.pipelineJobs(PROJECT, IID, 18320);

    expect(byName(columns, 'restore')).toMatchObject({ state: 'passed', action: null });
    const others = flat(columns).filter((j) => j.name !== 'restore');
    expect(others).toHaveLength(8);
    for (const j of others) {
      expect(j, j.name).toMatchObject({ state: 'canceled', action: 'retry', durationSecs: null });
    }
  });

  it('F-20.2 job ids are unique across the three pipelines (Retry and Cancel take only the job id)', async () => {
    const mock = await backend();

    const ids: number[] = [];
    for (const pipeline of [18342, 18321, 18320]) {
      ids.push(...flat(await mock.pipelineJobs(PROJECT, IID, pipeline)).map((j) => j.id));
    }

    expect(ids).toHaveLength(27);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('F-20.2 a pipeline the mock does not know is the 404 of GitLab', async () => {
    const mock = await backend();

    await expect(mock.pipelineJobs(PROJECT, IID, 99999)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
  });

  it('F-20.2 Retry on the failed unit-tests of #18321 answers a new attempt that runs, with Cancel', async () => {
    const mock = await backend();
    const before = byName(await mock.pipelineJobs(PROJECT, IID, 18321), 'unit-tests');

    const attempt = await mock.jobRetry(PROJECT, IID, before.id);

    expect(attempt.name).toBe('unit-tests');
    expect(attempt.id).not.toBe(before.id);
    expect(attempt.state).toBe('running');
    expect(attempt.action).toBe('cancel');
  });

  it('F-20.2 after a Retry the pipeline lists the new attempt in the same place and leaves every other row alone', async () => {
    const mock = await backend();
    const before = await mock.pipelineJobs(PROJECT, IID, 18321);
    const failed = byName(before, 'unit-tests');

    const attempt = await mock.jobRetry(PROJECT, IID, failed.id);
    const after = await mock.pipelineJobs(PROJECT, IID, 18321);

    expect(after.map((c) => c.jobs.map((j) => j.name))).toEqual(
      before.map((c) => c.jobs.map((j) => j.name)),
    );
    expect(byName(after, 'unit-tests')).toMatchObject({
      id: attempt.id,
      state: 'running',
      action: 'cancel',
    });
    expect(byName(after, 'sonar')).toEqual(byName(before, 'sonar'));
    expect(byName(after, 'restore')).toEqual(byName(before, 'restore'));
  });

  it('F-20.2 Cancel on the running attempt answers a canceled row with Retry, and the pipeline lists it so', async () => {
    const mock = await backend();
    const failed = byName(await mock.pipelineJobs(PROJECT, IID, 18321), 'unit-tests');
    const attempt = await mock.jobRetry(PROJECT, IID, failed.id);

    const canceled = await mock.jobCancel(PROJECT, IID, attempt.id);

    expect(canceled).toMatchObject({ id: attempt.id, state: 'canceled', action: 'retry' });
    expect(byName(await mock.pipelineJobs(PROJECT, IID, 18321), 'unit-tests')).toMatchObject({
      id: attempt.id,
      state: 'canceled',
      action: 'retry',
    });
  });

  it('F-20.2 a retry in one mock client does not show in another', async () => {
    const mock = await backend();
    const failed = byName(await mock.pipelineJobs(PROJECT, IID, 18321), 'unit-tests');
    await mock.jobRetry(PROJECT, IID, failed.id);

    const fresh = await backend();

    expect(byName(await fresh.pipelineJobs(PROJECT, IID, 18321), 'unit-tests')).toMatchObject({
      id: failed.id,
      state: 'failed',
    });
  });

  it('F-20.2 Retry and Cancel on a job the mock does not know are the 404 of GitLab', async () => {
    const mock = await backend();

    await expect(mock.jobRetry(PROJECT, IID, 987654)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
    await expect(mock.jobCancel(PROJECT, IID, 987654)).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
    });
  });
});
