import type { JobAction } from '../../types/JobAction';
import type { JobRow } from '../../types/JobRow';
import type { JobState } from '../../types/JobState';
import type { PipelineHead } from '../../types/PipelineHead';
import type { PipelineTab } from '../../types/PipelineTab';
import type { StageColumn } from '../../types/StageColumn';

/** The MR whose pipelines Pipeline.dc.html shows. */
export const PIPELINE_MR = 482;

/** The heads of versions 3 and 2 of !482 (Pipeline.dc.html: a3f9c12, 6a02f9e). */
export const SHA_V3 = 'a3f9c12'.padEnd(40, '0');
export const SHA_V2 = '6a02f9e'.padEnd(40, '0');

const MINUTE = 60_000;

/** One pipeline of !482: its tab and how long ago it started. */
interface MockPipeline {
  tab: Omit<PipelineTab, 'latest'>;
  head: Omit<PipelineHead, 'startedAt' | 'status' | 'number' | 'sha' | 'version'>;
  startedMinutesAgo: number;
}

/**
 * !482's pipelines as Pipeline.dc.html lists them, newest first (its #18351 is the new pipeline
 * of F-20.3). #18320 has no duration: "canceled by a newer push" is not data GitLab's REST gives.
 */
const PIPELINES: MockPipeline[] = [
  {
    tab: { id: 18342, number: 18342, sha: SHA_V3, version: 3, status: 'passed' },
    head: {
      allowedFailures: 1,
      kind: 'Merge request pipeline',
      author: 'Marta K.',
      startedByMe: false,
      durationSecs: 14 * 60,
    },
    startedMinutesAgo: 2 * 60 + 10,
  },
  {
    tab: { id: 18321, number: 18321, sha: SHA_V2, version: 2, status: 'failed' },
    head: {
      allowedFailures: 0,
      kind: 'Merge request pipeline',
      author: 'Marta K.',
      startedByMe: false,
      durationSecs: 9 * 60,
    },
    startedMinutesAgo: 3 * 60 + 20,
  },
  {
    tab: { id: 18320, number: 18320, sha: SHA_V2, version: 2, status: 'canceled' },
    head: {
      allowedFailures: 0,
      kind: 'Merge request pipeline',
      author: 'Marta K.',
      startedByMe: false,
      durationSecs: null,
    },
    startedMinutesAgo: 3 * 60 + 25,
  },
];

/** The tabs of MR `iid`: !482's three, none for any other MR. */
export function pipelineTabs(iid: number): PipelineTab[] {
  if (iid !== PIPELINE_MR) return [];
  return PIPELINES.map((p, index) => ({ ...p.tab, latest: index === 0 }));
}

/** The head of pipeline `id` of MR `iid`; `null` when the MR has no such pipeline. */
export function pipelineHead(iid: number, id: number, now: Date = new Date()): PipelineHead | null {
  if (iid !== PIPELINE_MR) return null;
  const pipeline = PIPELINES.find((p) => p.tab.id === id);
  if (!pipeline) return null;
  return {
    ...pipeline.head,
    status: pipeline.tab.status,
    number: pipeline.tab.number,
    sha: pipeline.tab.sha,
    version: pipeline.tab.version,
    startedAt: new Date(now.getTime() - pipeline.startedMinutesAgo * MINUTE).toISOString(),
  };
}

/** One job of !482's pipelines (Pipeline.dc.html): its stage, name and duration in #18342. */
const JOBS: { stage: string; name: string; secs: number | null }[] = [
  { stage: 'build', name: 'restore', secs: 48 },
  { stage: 'build', name: 'build:android', secs: 372 },
  { stage: 'build', name: 'build:ios', secs: 460 },
  { stage: 'test', name: 'unit-tests', secs: 112 },
  { stage: 'test', name: 'ui-tests:android', secs: 185 },
  { stage: 'test', name: 'ui-tests:ios-device', secs: null },
  { stage: 'quality', name: 'dotnet-format', secs: 22 },
  { stage: 'quality', name: 'sonar', secs: 130 },
  { stage: 'distribute', name: 'distribute:qa', secs: null },
];

/** The state of each job of a pipeline that is not passed (decision 6 gives the action). */
const NOT_PASSED: Record<number, (name: string) => JobState | null> = {
  18342: (name) =>
    name === 'ui-tests:android'
      ? 'failedAllowed'
      : name === 'ui-tests:ios-device' || name === 'distribute:qa'
        ? 'manual'
        : null,
  18321: (name) =>
    name === 'unit-tests'
      ? 'failed'
      : ['ui-tests:ios-device', 'dotnet-format', 'sonar', 'distribute:qa'].includes(name)
        ? 'skipped'
        : null,
  18320: (name) => (name === 'restore' ? null : 'canceled'),
};

/** The row's one button as the core gives it (M6 decision 6). */
export function jobAction(state: JobState): JobAction | null {
  switch (state) {
    case 'failed':
    case 'failedAllowed':
    case 'canceled':
      return 'retry';
    case 'running':
    case 'waiting':
      return 'cancel';
    case 'manual':
      return 'run';
    case 'passed':
    case 'skipped':
      return null;
  }
}

/**
 * The stage columns of pipeline `id` of !482 (`null` for any other pipeline), job ids unique
 * across the three pipelines (`<pipeline><index>`). A job that did not run has no duration.
 */
export function pipelineColumns(id: number): StageColumn[] | null {
  const stateOf = NOT_PASSED[id];
  if (!stateOf) return null;
  const columns: StageColumn[] = [];
  JOBS.forEach((job, index) => {
    const state = stateOf(job.name) ?? 'passed';
    const ran = state === 'passed' || state === 'failed' || state === 'failedAllowed';
    const row: JobRow = {
      id: id * 100 + index + 1,
      name: job.name,
      state,
      action: jobAction(state),
      durationSecs: ran ? job.secs : null,
    };
    const last = columns[columns.length - 1];
    if (last?.name === job.stage) last.jobs.push(row);
    else columns.push({ name: job.stage, jobs: [row] });
  });
  return columns;
}
