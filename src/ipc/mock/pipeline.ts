import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabUser } from '../types/GitlabUser';
import type { JobRow } from '../types/JobRow';
import type { JobVariable } from '../types/JobVariable';
import type { PipelineHead } from '../types/PipelineHead';
import type { PipelineState } from '../types/PipelineState';
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
import { jobArtifacts } from './fixtures/pipelineArtifacts';
import { failedAgain } from './fixtures/pipelineRetried';
import { jobPage } from './fixtures/pipelineLog';
import { type FoundJob, traceJob } from './pipelineLog';
import { createExplainBackend } from './pipelineExplain';

type PipelineCommands =
  | 'pipelineList'
  | 'pipelineGet'
  | 'pipelineJobs'
  | 'jobRetry'
  | 'jobCancel'
  | 'jobPlay'
  | 'jobVariablesGet'
  | 'pipelineMrHead'
  | 'pipelineRunMr'
  | 'pipelineRetry'
  | 'pipelineCancel'
  | 'jobTrace'
  | 'jobExplain'
  | 'jobArtifacts'
  | 'jobDetails';

/** GitLab's 400 for a play of a job that is not manual, in its own words. */
const unplayable = () =>
  new IpcError({ code: 'INVALID_INPUT', message: 'Unplayable Job', retryable: false });

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
 * pipeline of this client, once; any other MR is GitLab's 404. `pipelineRetry` and
 * `pipelineCancel` (F-20.4): Retry failed jobs gives every failed, failed-allowed and canceled job
 * a running attempt with a new id and the pipeline reads Running; Cancel pipeline cancels every
 * running and waiting job and the pipeline reads Canceled; passed, skipped and manual jobs stay.
 * `jobTrace` (F-20.5): the log of any job of !482's pipelines (`pipelineLog.ts`); every row has
 * its page on the mock server as `webUrl`. `jobPlay` (F-20.6): a manual job reads Waiting with
 * Cancel and its variables become the last values of its project and job name (this client only);
 * any other job is GitLab's 400, an unknown one its 404, and neither saves. `jobVariablesGet` reads
 * the saved values (no GitLab call, so no account needed, like the core's store read).
 * `jobExplain` (F-20.7): `pipelineExplain.ts`. `jobArtifacts` (F-20.8): the files of
 * `fixtures/pipelineArtifacts.ts` by job name, none for the rest; an unknown job is GitLab's 404.
 * `jobDetails` (F-20.9): a failed job of `failedAgain` failed again on the same test; the rest
 * read false; an unknown job is GitLab's 404.
 */
export function createPipelineBackend(
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
): Pick<IpcClient, PipelineCommands> {
  const jobs = new Map<number, StageColumn[]>();
  /** The last variables per `project` and job name, as `job_variables` keeps them. */
  const lastVars = new Map<string, JobVariable[]>();
  const varsKey = (project: string, name: string) => `${project}
${name}`;
  let nextId = FIRST_ATTEMPT_ID;
  /** The fixture pipelines started relative to this, so a pipeline's start time never moves. */
  const loadedAt = new Date();
  /** When Run new pipeline started #18351; null before. */
  let ranAt: Date | null = null;
  /** The status a pipeline-level Retry or Cancel left a pipeline of !482 in. */
  const statuses = new Map<number, PipelineState>();
  const withStatus = (tab: PipelineTab): PipelineTab => ({
    ...tab,
    status: statuses.get(tab.id) ?? tab.status,
  });
  const tabsOf = (iid: number): PipelineTab[] => {
    const tabs = pipelineTabs(iid);
    if (iid !== PIPELINE_MR) return tabs;
    if (ranAt === null) return tabs.map(withStatus);
    return [newTab(), ...tabs.map((t) => ({ ...t, latest: false }))].map(withStatus);
  };
  const headOf = (iid: number, id: number): PipelineHead | null => {
    const head =
      iid === PIPELINE_MR && id === NEW_PIPELINE
        ? ranAt === null
          ? null
          : newPipelineHead(ranAt, user()?.name ?? null)
        : pipelineHead(iid, id, loadedAt);
    const status = statuses.get(id);
    if (!head || status === undefined) return head;
    return {
      ...head,
      status,
      allowedFailures: 0,
      durationSecs: status === 'running' ? null : head.durationSecs,
    };
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
  /** Job `id` of any of !482's pipelines with its pipeline and stage; null when no job has it. */
  const find = (id: number): FoundJob | null => {
    for (const tab of tabsOf(PIPELINE_MR)) {
      for (const column of columnsOf(tab.id) ?? []) {
        const row = column.jobs.find((j) => j.id === id);
        if (row) return { row: { ...row }, pipeline: tab.id, stage: column.name };
      }
    }
    return null;
  };
  /** Rewrites every job of pipeline `id` of MR `iid`, then gives it `status`; its new head. */
  const actAll = (
    iid: number,
    id: number,
    status: PipelineState,
    next: (row: JobRow) => JobRow,
  ): Promise<PipelineHead> => {
    if (!user()) return Promise.reject(unauthorized());
    const columns = iid === PIPELINE_MR && headOf(iid, id) ? columnsOf(id) : null;
    if (!columns) return Promise.reject(notFound());
    for (const column of columns) column.jobs = column.jobs.map(next);
    statuses.set(id, status);
    const head = headOf(iid, id);
    return head ? respond(head) : Promise.reject(notFound());
  };
  const act = (id: number, next: (row: JobRow) => JobRow): Promise<JobRow> => {
    if (!user()) return Promise.reject(unauthorized());
    const row = change(id, next);
    return row ? respond({ ...row }) : Promise.reject(notFound());
  };

  return {
    ...createExplainBackend(user, unauthorized, notFound, find),
    pipelineList: (_project, iid) => {
      if (!user()) return Promise.reject(unauthorized());
      return respond(tabsOf(iid));
    },
    pipelineGet: (_project, iid, id) => {
      if (!user()) return Promise.reject(unauthorized());
      const head = headOf(iid, id);
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
          webUrl: jobPage(nextId),
        };
      }),
    jobCancel: (_project, _iid, job) =>
      act(job, (row) => ({
        ...row,
        state: 'canceled',
        action: jobAction('canceled'),
        durationSecs: null,
      })),
    jobPlay: (project, _iid, job, vars) => {
      if (!user()) return Promise.reject(unauthorized());
      const found = find(job);
      if (!found) return Promise.reject(notFound());
      if (found.row.state !== 'manual') return Promise.reject(unplayable());
      const row = change(job, (old) => ({
        ...old,
        state: 'waiting',
        action: jobAction('waiting'),
        durationSecs: null,
      }));
      if (!row) return Promise.reject(notFound());
      lastVars.set(
        varsKey(project, row.name),
        vars.map((v) => ({ ...v })),
      );
      return respond({ ...row });
    },
    jobVariablesGet: (project, jobName) =>
      respond((lastVars.get(varsKey(project, jobName)) ?? []).map((v) => ({ ...v }))),
    pipelineRetry: (_project, iid, id) =>
      actAll(iid, id, 'running', (row) => {
        if (row.state !== 'failed' && row.state !== 'failedAllowed' && row.state !== 'canceled') {
          return row;
        }
        nextId += 1;
        return {
          ...row,
          id: nextId,
          state: 'running',
          action: jobAction('running'),
          durationSecs: null,
          webUrl: jobPage(nextId),
        };
      }),
    pipelineCancel: (_project, iid, id) =>
      actAll(iid, id, 'canceled', (row) =>
        row.state === 'running' || row.state === 'waiting'
          ? { ...row, state: 'canceled', action: jobAction('canceled'), durationSecs: null }
          : row,
      ),
    jobTrace: async (_project, _iid, job, onEvent, signal) => {
      if (!user()) throw unauthorized();
      const found = find(job);
      if (!found) throw notFound();
      await respond(null);
      await traceJob(found, onEvent, signal);
    },
    jobArtifacts: (_project, _iid, job) => {
      if (!user()) return Promise.reject(unauthorized());
      const found = find(job);
      if (!found) return Promise.reject(notFound());
      return respond(jobArtifacts(found.row.id, found.row.name));
    },
    jobDetails: (_project, _iid, job) => {
      if (!user()) return Promise.reject(unauthorized());
      const found = find(job);
      if (!found) return Promise.reject(notFound());
      const failed = found.row.state === 'failed' || found.row.state === 'failedAllowed';
      return respond({
        retriedSameFailure: failed && failedAgain(found.pipeline, found.row.name),
      });
    },
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
