import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { JobRow } from '../types/JobRow';
import type { PipelineHead } from '../types/PipelineHead';
import type { PipelineTab } from '../types/PipelineTab';
import type { StageColumn } from '../types/StageColumn';

export const pipelineListKey = (project: string, iid: number) =>
  ['gitlab', 'pipelines', project, iid] as const;
export const pipelineHeadKey = (project: string, iid: number, id: number) =>
  ['gitlab', 'pipeline', project, iid, id] as const;
export const pipelineJobsKey = (project: string, iid: number, id: number) =>
  ['gitlab', 'pipeline-jobs', project, iid, id] as const;

/** How often an active pipeline and its jobs are read again (M6 decision 7). */
export const PIPELINE_POLL_MS = 5_000;

/** A pipeline is active while a job runs or waits (created, pending…) (decision 7). */
export function hasActiveJob(columns: StageColumn[] | undefined): boolean {
  return (columns ?? []).some((c) =>
    c.jobs.some((j) => j.state === 'running' || j.state === 'waiting'),
  );
}

/**
 * S-08's tabs: the MR's pipelines newest first (F-20.1). `enabled` is false on a restored start
 * and until the project is known (F-30.4).
 */
export function usePipelineList(
  project: string | undefined,
  iid: number,
  enabled: boolean,
): UseQueryResult<PipelineTab[], IpcError> {
  const ipc = useIpc();
  return useQuery<PipelineTab[], IpcError>({
    queryKey: pipelineListKey(project ?? '', iid),
    queryFn: () => ipc.pipelineList(project ?? '', iid),
    enabled: enabled && project !== undefined && project !== '',
  });
}

/**
 * The status block and meta line of the selected pipeline (F-20.1); `id` null reads nothing.
 * `live` re-reads it every 5 s while a job of it runs or waits (F-20.2, decision 7).
 */
export function usePipelineHead(
  project: string | undefined,
  iid: number,
  id: number | null,
  live = false,
): UseQueryResult<PipelineHead, IpcError> {
  const ipc = useIpc();
  return useQuery<PipelineHead, IpcError>({
    queryKey: pipelineHeadKey(project ?? '', iid, id ?? 0),
    queryFn: () => ipc.pipelineGet(project ?? '', iid, id ?? 0),
    enabled: project !== undefined && project !== '' && id !== null,
    refetchInterval: live ? PIPELINE_POLL_MS : false,
  });
}

/**
 * The stage columns of the selected pipeline (F-20.2); `id` null reads nothing. Read again every
 * 5 s while a job runs or waits, never for a finished pipeline (decision 7); the polling stops
 * when the screen closes.
 */
export function usePipelineJobs(
  project: string | undefined,
  iid: number,
  id: number | null,
): UseQueryResult<StageColumn[], IpcError> {
  const ipc = useIpc();
  return useQuery<StageColumn[], IpcError>({
    queryKey: pipelineJobsKey(project ?? '', iid, id ?? 0),
    queryFn: () => ipc.pipelineJobs(project ?? '', iid, id ?? 0),
    enabled: project !== undefined && project !== '' && id !== null,
    refetchInterval: (query) => (hasActiveJob(query.state.data) ? PIPELINE_POLL_MS : false),
  });
}

/** Replaces the row of job `oldId` in the cached columns with `row`. */
function withRow(columns: StageColumn[] | undefined, oldId: number, row: JobRow) {
  return columns?.map((c) => ({
    ...c,
    jobs: c.jobs.map((j) => (j.id === oldId ? row : j)),
  }));
}

export interface JobActions {
  /** Retry job `id` at once; the row becomes the new attempt (a new id). */
  retry: UseMutationResult<JobRow, IpcError, number>;
  /** Cancel job `id` at once. */
  cancel: UseMutationResult<JobRow, IpcError, number>;
}

/**
 * The row-level Retry and Cancel of pipeline `pipeline` (F-20.2, decision 6), each sent only by
 * its own click and at once. GitLab's answer replaces the row; then the jobs and the head are
 * read again.
 */
export function useJobActions(project: string, iid: number, pipeline: number): JobActions {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const settle = (oldId: number, row: JobRow) => {
    queryClient.setQueryData<StageColumn[]>(pipelineJobsKey(project, iid, pipeline), (columns) =>
      withRow(columns, oldId, row),
    );
    void queryClient.invalidateQueries({ queryKey: pipelineJobsKey(project, iid, pipeline) });
    void queryClient.invalidateQueries({ queryKey: pipelineHeadKey(project, iid, pipeline) });
  };
  const retry = useMutation<JobRow, IpcError, number>({
    mutationFn: (id) => ipc.jobRetry(project, iid, id),
    onSuccess: (row, id) => {
      settle(id, row);
    },
  });
  const cancel = useMutation<JobRow, IpcError, number>({
    mutationFn: (id) => ipc.jobCancel(project, iid, id),
    onSuccess: (row, id) => {
      settle(id, row);
    },
  });
  return { retry, cancel };
}

export interface RunPipeline {
  /** Reads the MR's head SHA the confirmation names (F-20.3); read only, on each opening. */
  head: UseMutationResult<string, IpcError, undefined>;
  /** Starts a new merge request pipeline; sent only by the confirmation's Run pipeline. */
  run: UseMutationResult<PipelineTab, IpcError, undefined>;
}

/**
 * Run new pipeline (F-20.3): the head SHA for the confirmation, and the one run. GitLab's new
 * pipeline becomes the cached list's first, latest tab at once; then the list is read again.
 */
export function useRunPipeline(project: string, iid: number): RunPipeline {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const head = useMutation<string, IpcError, undefined>({
    mutationFn: () => ipc.pipelineMrHead(project, iid),
  });
  const run = useMutation<PipelineTab, IpcError, undefined>({
    mutationFn: () => ipc.pipelineRunMr(project, iid),
    onSuccess: (tab) => {
      queryClient.setQueryData<PipelineTab[]>(pipelineListKey(project, iid), (tabs) => [
        tab,
        ...(tabs ?? []).filter((t) => t.id !== tab.id).map((t) => ({ ...t, latest: false })),
      ]);
      void queryClient.invalidateQueries({ queryKey: pipelineListKey(project, iid) });
    },
  });
  return { head, run };
}
