import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { JobDetailsView } from '../types/JobDetailsView';

export const jobDetailsKey = (project: string, iid: number, job: number) =>
  ['gitlab', 'job-details', project, iid, job] as const;

/**
 * The details panel's facts about failed job `job` (F-20.9, M6 decision 15); `null` reads nothing
 * (only a failed job has "Why it failed"). A finished attempt does not change, so no polling.
 */
export function useJobDetails(
  project: string,
  iid: number,
  job: number | null,
): UseQueryResult<JobDetailsView, IpcError> {
  const ipc = useIpc();
  return useQuery<JobDetailsView, IpcError>({
    queryKey: jobDetailsKey(project, iid, job ?? 0),
    queryFn: () => ipc.jobDetails(project, iid, job ?? 0),
    enabled: job !== null,
  });
}
