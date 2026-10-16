import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { AnalysisStatus } from '../types/AnalysisStatus';

/** S-04's footer status of a session; a step task's `started`, `done` and `failed` refresh it. */
export const analysisStatusKey = (sessionId: string) =>
  ['review', 'analysisStatus', sessionId] as const;

/** How often the status is read while a step runs: a prefetch sends the UI no events. */
export const RUNNING_REFRESH_MS = 1000;

/**
 * The session's steps whose analysis is ready, running or failed and the code Claude reads
 * (F-08.8). Read again while a step runs, until none does.
 */
export function useAnalysisStatus(sessionId: string): UseQueryResult<AnalysisStatus, IpcError> {
  const ipc = useIpc();
  return useQuery<AnalysisStatus, IpcError>({
    queryKey: analysisStatusKey(sessionId),
    queryFn: () => ipc.reviewAnalysisStatus(sessionId),
    enabled: sessionId !== '',
    retry: false,
    refetchInterval: (query) =>
      (query.state.data?.running.length ?? 0) > 0 ? RUNNING_REFRESH_MS : false,
  });
}
