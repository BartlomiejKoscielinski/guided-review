import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { ApprovalState } from '../types/ApprovalState';

export const approvalStateKey = (sessionId: string) => ['gitlab', 'approval', sessionId] as const;

/**
 * The approval state of the session's MR (S-05 Approval tile, F-14.1), read when the summary
 * opens. `enabled` is false on a restored start, which calls no GitLab command (F-30.4).
 */
export function useApprovalState(
  sessionId: string,
  enabled: boolean,
): UseQueryResult<ApprovalState, IpcError> {
  const ipc = useIpc();
  return useQuery<ApprovalState, IpcError>({
    queryKey: approvalStateKey(sessionId),
    queryFn: () => ipc.gitlabApprovalState(sessionId),
    enabled: enabled && sessionId !== '',
  });
}
