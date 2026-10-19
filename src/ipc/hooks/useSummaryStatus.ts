import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { SummaryStatus } from '../types/SummaryStatus';

export const summaryStatusKey = (sessionId: string) =>
  ['gitlab', 'summary-status', sessionId] as const;

/**
 * The reviewed head against the MR's head now (S-05, F-14.2): `changed` shows the MR-changed
 * banner and disables Approve MR. `enabled` is false on a restored start (F-30.4).
 */
export function useSummaryStatus(
  sessionId: string,
  enabled: boolean,
): UseQueryResult<SummaryStatus, IpcError> {
  const ipc = useIpc();
  return useQuery<SummaryStatus, IpcError>({
    queryKey: summaryStatusKey(sessionId),
    queryFn: () => ipc.summaryStatus(sessionId),
    enabled: enabled && sessionId !== '',
  });
}
