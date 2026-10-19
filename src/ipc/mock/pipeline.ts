import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabUser } from '../types/GitlabUser';
import type { JobRow } from '../types/JobRow';
import type { PipelineTab } from '../types/PipelineTab';
import type { StageColumn } from '../types/StageColumn';
import {
  NEW_PIPELINE,
  PIPELINE_MR,
  SHA_V3,
  jobAction,
  newPipelineColumns,
  newPipelineHead,
  pipelineColumns,
  pipelineHead,
  pipelineTabs,
} from './fixtures/pipeline';

type PipelineCommands =
  | 'pipelineList'
  | 'pipelineGet'
  | 'pipelineJobs'
  | 'jobRetry'
  | 'jobCancel'
  | 'pipelineMrHead'
  | 'pipelineRunMr';

const notFound = () =>
  new IpcError({ code: 'GITLAB_NOT_FOUND', message: "GitLab didn't find it.", retryable: false });

/** The first id a retried attempt gets; above every fixture job id. */
const FIRST_ATTEMPT_ID = 9_000_000;

/**
 * `pipelineList`, `pipelineGet` (F-20.1), `pipelineJobs`, `jobRetry` and `jobCancel` (F-20.2) as
 * `commands/pipeline.rs` answers them: no GitLab account first, then the data of
 * `fixtures/pipeline.ts`; an unknown pipeline or job is GitLab's 404. Retry and Cancel change
 * this client's copy of the jobs only: a retry puts a running attempt with a new id in the old
 * row's place, a cancel leaves the row canceled. `pipelineMrHead` and `pipelineRunMr` (F-20.3):
 * !482's head is version 3's SHA; a run adds #18351 (`fixtures/pipeline.ts`) as the latest
 * pipeline of this client, once; any other MR is GitLab's 404.
 */
export function createPipelineBackend(
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
): Pick<IpcClient, PipelineCommands> {
  const jobs = new Map<number, StageColumn[]>();
  let nextId = FIRST_ATTEMPT_ID;
  /** The fixture pipelines started relative to this, so a pipeline's start time never moves. */
  const loadedAt = new Date();
  /** When Run new pipeline started #18351; null before. */
  let ranAt: Date | null = null;
  const tabsOf = (iid: number): PipelineTab[] => {
    const tabs = pipelineTabs(iid);
    if (iid !== PIPELINE_MR || ranAt === null) return tabs;
    return [newTab(), ...tabs.map((t) => ({ ...t, latest: false }))];
  };
  const columnsOf = (pipeline: number): StageColumn[] | null => {
    const known = jobs.get(pipeline);
    if (known) return known;
    const fresh =
      pipeline === NEW_PIPELINE
        ? ranAt === null
          ? null
          : newPipelineColumns()
        : pipelineColumns(pipeline);
    if (fresh) jobs.set(pipeline, fresh);
    return fresh;
  };
  /** Replaces job `id` of any of !482's pipelines with `next(row)`; null when no job has it. */
  const change = (id: number, next: (row: JobRow) => JobRow): JobRow | null => {
    for (const tab of tabsOf(PIPELINE_MR)) {
      for (const column of columnsOf(tab.id) ?? []) {
        const index = column.jobs.findIndex((j) => j.id === id);
        const old = column.jobs[index];
        if (old) {
          const row = next(old);
          column.jobs[index] = row;
          return row;
        }
      }
    }
    return null;
  };
  const act = (id: number, next: (row: JobRow) => JobRow): Promise<JobRow> => {
    if (!user()) return Promise.reject(unauthorized());
    const row = change(id, next);
    return row ? respond({ ...row }) : Promise.reject(notFound());
  };

  return {
    pipelineList: (_project, iid) => {
      if (!user()) return Promise.reject(unauthorized());
      return respond(tabsOf(iid));
    },
    pipelineGet: (_project, iid, id) => {
      if (!user()) return Promise.reject(unauthorized());
      const head =
        iid === PIPELINE_MR && id === NEW_PIPELINE
          ? ranAt === null
            ? null
            : newPipelineHead(ranAt, user()?.name ?? null)
          : pipelineHead(iid, id, loadedAt);
      if (!head) return Promise.reject(notFound());
      return respond(head);
    },
    pipelineJobs: (_project, _iid, pipeline) => {
      if (!user()) return Promise.reject(unauthorized());
      const columns = columnsOf(pipeline);
      if (!columns) return Promise.reject(notFound());
      return respond(columns.map((c) => ({ name: c.name, jobs: c.jobs.map((j) => ({ ...j })) })));
    },
    jobRetry: (_project, _iid, job) =>
      act(job, (row) => {
        nextId += 1;
        return {
          ...row,
          id: nextId,
          state: 'running',
          action: jobAction('running'),
          durationSecs: null,
        };
      }),
    jobCancel: (_project, _iid, job) =>
      act(job, (row) => ({
        ...row,
        state: 'canceled',
        action: jobAction('canceled'),
        durationSecs: null,
      })),
    pipelineMrHead: (_project, iid) => {
      if (!user()) return Promise.reject(unauthorized());
      return iid === PIPELINE_MR ? respond(SHA_V3) : Promise.reject(notFound());
    },
    pipelineRunMr: (_project, iid) => {
      if (!user()) return Promise.reject(unauthorized());
      if (iid !== PIPELINE_MR) return Promise.reject(notFound());
      ranAt ??= new Date();
      return respond(newTab());
    },
  };
}

/** #18351 as its tab: the newest pipeline, on version 3's head, running. */
function newTab(): PipelineTab {
  return {
    id: NEW_PIPELINE,
    number: NEW_PIPELINE,
    sha: SHA_V3,
    version: 3,
    latest: true,
    status: 'running',
  };
}
