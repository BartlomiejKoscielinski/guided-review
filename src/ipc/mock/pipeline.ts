import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabUser } from '../types/GitlabUser';
import type { JobRow } from '../types/JobRow';
import type { StageColumn } from '../types/StageColumn';
import {
  PIPELINE_MR,
  jobAction,
  pipelineColumns,
  pipelineHead,
  pipelineTabs,
} from './fixtures/pipeline';

type PipelineCommands = 'pipelineList' | 'pipelineGet' | 'pipelineJobs' | 'jobRetry' | 'jobCancel';

const notFound = () =>
  new IpcError({ code: 'GITLAB_NOT_FOUND', message: "GitLab didn't find it.", retryable: false });

/** The first id a retried attempt gets; above every fixture job id. */
const FIRST_ATTEMPT_ID = 9_000_000;

/**
 * `pipelineList`, `pipelineGet` (F-20.1), `pipelineJobs`, `jobRetry` and `jobCancel` (F-20.2) as
 * `commands/pipeline.rs` answers them: no GitLab account first, then the data of
 * `fixtures/pipeline.ts`; an unknown pipeline or job is GitLab's 404. Retry and Cancel change
 * this client's copy of the jobs only: a retry puts a running attempt with a new id in the old
 * row's place, a cancel leaves the row canceled.
 */
export function createPipelineBackend(
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
): Pick<IpcClient, PipelineCommands> {
  const jobs = new Map<number, StageColumn[]>();
  let nextId = FIRST_ATTEMPT_ID;
  const columnsOf = (pipeline: number): StageColumn[] | null => {
    const known = jobs.get(pipeline);
    if (known) return known;
    const fresh = pipelineColumns(pipeline);
    if (fresh) jobs.set(pipeline, fresh);
    return fresh;
  };
  /** Replaces job `id` of any of !482's pipelines with `next(row)`; null when no job has it. */
  const change = (id: number, next: (row: JobRow) => JobRow): JobRow | null => {
    for (const tab of pipelineTabs(PIPELINE_MR)) {
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
      return respond(pipelineTabs(iid));
    },
    pipelineGet: (_project, iid, id) => {
      if (!user()) return Promise.reject(unauthorized());
      const head = pipelineHead(iid, id);
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
  };
}
