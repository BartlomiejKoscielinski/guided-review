import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { IpcClient } from '../client';

// F-20.6 in the mock backend, as the core answers `job_play(project, iid, job, vars)` and
// `job_variables_get(project, job_name)` (M6 plan, decision 11). Client names: `jobPlay(project,
// iid, job, vars) -> JobRow` and `jobVariablesGet(project, jobName) -> {key, value}[]`.
//
//  - Playing a manual job keeps its id and name; the row reads Waiting with the action Cancel, and
//    `pipelineJobs` shows it so afterwards.
//  - The variables of a successful play are saved per project and job name, in the order given
//    (empty for a job name never played); a play of anything that is not a manual job is refused
//    and saves nothing; an unknown job is GitLab's 404 ("GitLab didn't find it.").
//  - Values are stored as typed.

const PROJECT = 'mobile/mobile-app';
const IID = 482;

type Row = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number]['jobs'][number];

async function backend() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  return mock;
}

async function find(mock: IpcClient, pipeline: number, name: string): Promise<Row> {
  const columns = await mock.pipelineJobs(PROJECT, IID, pipeline);
  const found = columns.flatMap((c) => c.jobs).find((j) => j.name === name);
  if (!found) throw new Error(`no job ${name}`);
  return found;
}

describe('mock job_play and job_variables_get (F-20.6)', () => {
  it('F-20.6 a job name never played has no saved variables', async () => {
    const mock = await backend();

    expect(await mock.jobVariablesGet(PROJECT, 'distribute:qa')).toEqual([]);
  });

  it('F-20.6 playing a manual job keeps its id and name and reads Waiting with Cancel', async () => {
    const mock = await backend();
    const before = await find(mock, 18342, 'ui-tests:ios-device');
    expect(before.state).toBe('manual');

    const played = await mock.jobPlay(PROJECT, IID, before.id, [
      { key: 'DEVICE', value: 'iPhone 16' },
    ]);

    expect(played).toMatchObject({
      id: before.id,
      name: 'ui-tests:ios-device',
      state: 'waiting',
      action: 'cancel',
    });
    expect(await find(mock, 18342, 'ui-tests:ios-device')).toMatchObject({
      state: 'waiting',
      action: 'cancel',
    });
    expect((await find(mock, 18342, 'distribute:qa')).state).toBe('manual');
  });

  it('F-20.6 a successful play saves its variables per job name, in order and as typed', async () => {
    const mock = await backend();
    const job = await find(mock, 18342, 'distribute:qa');
    const vars = [
      { key: 'RELEASE_NOTES', value: '  MR !482 · kolejka zdjęć  ' },
      { key: 'CHANNEL', value: '' },
    ];

    await mock.jobPlay(PROJECT, IID, job.id, vars);

    expect(await mock.jobVariablesGet(PROJECT, 'distribute:qa')).toEqual(vars);
    expect(await mock.jobVariablesGet(PROJECT, 'ui-tests:ios-device')).toEqual([]);
  });

  it('F-20.6 a later play replaces the earlier values, an empty list included', async () => {
    const mock = await backend();
    const first = await find(mock, 18342, 'distribute:qa');
    await mock.jobPlay(PROJECT, IID, first.id, [{ key: 'A', value: '1' }]);
    await mock.pipelineRunMr(PROJECT, IID);
    const again = await find(mock, 18351, 'distribute:qa');
    expect(again.state).toBe('manual');

    await mock.jobPlay(PROJECT, IID, again.id, []);

    expect(await mock.jobVariablesGet(PROJECT, 'distribute:qa')).toEqual([]);
  });

  it('F-20.6 a job that is not manual is refused and saves nothing', async () => {
    const mock = await backend();
    const passed = await find(mock, 18342, 'unit-tests');
    expect(passed.state).toBe('passed');

    await expect(
      mock.jobPlay(PROJECT, IID, passed.id, [{ key: 'A', value: '1' }]),
    ).rejects.toBeInstanceOf(Error);

    expect(await mock.jobVariablesGet(PROJECT, 'unit-tests')).toEqual([]);
    expect((await find(mock, 18342, 'unit-tests')).state).toBe('passed');
  });

  it('F-20.6 an unknown job is GitLab’s 404 and saves nothing', async () => {
    const mock = await backend();

    await expect(
      mock.jobPlay(PROJECT, IID, 987_654, [{ key: 'A', value: '1' }]),
    ).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
      message: "GitLab didn't find it.",
    });
  });
});
