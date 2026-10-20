import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { JobArtifact } from '../types/JobArtifact';

export const jobArtifactsKey = (project: string, iid: number, job: number) =>
  ['gitlab', 'job-artifacts', project, iid, job] as const;

/**
 * The artifacts of successful job `job` (F-20.8, M6 decision 13); `null` reads nothing (a job
 * that did not pass has no section). A job's files do not change once it passed, so no polling.
 */
export function useJobArtifacts(
  project: string,
  iid: number,
  job: number | null,
): UseQueryResult<JobArtifact[], IpcError> {
  const ipc = useIpc();
  return useQuery<JobArtifact[], IpcError>({
    queryKey: jobArtifactsKey(project, iid, job ?? 0),
    queryFn: () => ipc.jobArtifacts(project, iid, job ?? 0),
    enabled: job !== null,
  });
}
