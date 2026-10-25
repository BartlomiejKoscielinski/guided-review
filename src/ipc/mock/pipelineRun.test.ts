import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { formatAge } from '../../format/age';

// F-20.3 in the mock backend, as the core answers `pipeline_mr_head(project, iid)` (the MR's head
// SHA the confirmation strip names) and `pipeline_run_mr(project, iid)` (the one POST that starts
// a merge request pipeline; plan M6 and Pipeline.dc.html's new pipeline #18351):
//
//   #18351  a3f9c12  version 3  latest  Running  started by you · just now  (no duration yet)
//
// The new pipeline is the mock's fourth: it is listed first and takes "latest" from #18342. Its
// jobs are the nine of the other pipelines: the build stage runs, the stages after it wait, and
// the two manual jobs stay manual ("Manual jobs stay manual."). Before the run the mock still has
// the three pipelines of F-20.1.

const PROJECT = 'mobile/mobile-app';
const IID = 482;

async function backend() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  return mock;
}

describe('mock run of a new pipeline (F-20.3)', () => {
  it('F-20.3 pipelineMrHead gives the full head SHA of !482: a3f9c12 and its 33 more characters', async () => {
    const mock = await backend();

    const sha = await mock.pipelineMrHead(PROJECT, IID);

    expect(sha).toMatch(/^a3f9c12[0-9a-f]{33}$/);
  });

  it('F-20.3 reading the head starts nothing: the pipelines stay the three of F-20.1', async () => {
    const mock = await backend();

    await mock.pipelineMrHead(PROJECT, IID);

    expect((await mock.pipelineList(PROJECT, IID)).map((t) => t.id)).toEqual([18342, 18321, 18320]);
  });

  it('F-20.3 pipelineRunMr returns the new pipeline #18351 as the latest tab: version 3, Running, the MR head SHA', async () => {
    const mock = await backend();
    const head = await mock.pipelineMrHead(PROJECT, IID);

    const tab = await mock.pipelineRunMr(PROJECT, IID);

    expect(tab).toMatchObject({
      id: 18351,
      number: 18351,
      version: 3,
      latest: true,
      status: 'running',
    });
    expect(tab.sha).toBe(head);
  });

  it('F-20.3 after the run the list has four pipelines, #18351 first and the only latest', async () => {
    const mock = await backend();

    await mock.pipelineRunMr(PROJECT, IID);
    const tabs = await mock.pipelineList(PROJECT, IID);

    expect(tabs.map((t) => t.id)).toEqual([18351, 18342, 18321, 18320]);
    expect(tabs.map((t) => t.latest)).toEqual([true, false, false, false]);
    expect(tabs.map((t) => t.version)).toEqual([3, 3, 2, 2]);
    expect(tabs[0]?.status).toBe('running');
  });

  it('F-20.3 the head of #18351 says started by you, just now, with no duration and no allowed-failure count', async () => {
    const mock = await backend();
    await mock.pipelineRunMr(PROJECT, IID);

    const head = await mock.pipelineGet(PROJECT, IID, 18351);

    expect(head).toMatchObject({
      status: 'running',
      allowedFailures: 0,
      number: 18351,
      kind: 'Merge request pipeline',
      version: 3,
      startedByMe: true,
      durationSecs: null,
    });
    expect(head.sha).toMatch(/^a3f9c12/);
    expect(formatAge(head.startedAt ?? '')).toBe('just now');
  });

  it('F-20.3 #18351 has the nine jobs: the build stage runs, later stages wait, the two manual jobs stay manual', async () => {
    const mock = await backend();
    await mock.pipelineRunMr(PROJECT, IID);

    const columns = await mock.pipelineJobs(PROJECT, IID, 18351);

    expect(columns.map((c) => c.name.toLowerCase())).toEqual([
      'build',
      'test',
      'quality',
      'distribute',
    ]);
    const state = (name: string) =>
      columns.flatMap((c) => c.jobs).find((j) => j.name === name)?.state;
    expect(['restore', 'build:android', 'build:ios'].map(state)).toEqual([
      'running',
      'running',
      'running',
    ]);
    expect(['unit-tests', 'ui-tests:android', 'dotnet-format', 'sonar'].map(state)).toEqual([
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
    expect(state('ui-tests:ios-device')).toBe('manual');
    expect(state('distribute:qa')).toBe('manual');
  });

  it('F-20.3 the job ids of #18351 are new: none equals a job of the other pipelines', async () => {
    const mock = await backend();
    const old = (
      await Promise.all([18342, 18321, 18320].map((id) => mock.pipelineJobs(PROJECT, IID, id)))
    )
      .flat()
      .flatMap((c) => c.jobs)
      .map((j) => j.id);
    await mock.pipelineRunMr(PROJECT, IID);

    const fresh = (await mock.pipelineJobs(PROJECT, IID, 18351)).flatMap((c) => c.jobs);

    expect(fresh).toHaveLength(9);
    expect(fresh.filter((j) => old.includes(j.id))).toEqual([]);
  });

  it('F-20.3 the pipelines before the run are unchanged by it', async () => {
    const mock = await backend();
    const before = await mock.pipelineGet(PROJECT, IID, 18342);

    await mock.pipelineRunMr(PROJECT, IID);

    expect(await mock.pipelineGet(PROJECT, IID, 18342)).toEqual(before);
  });
});
