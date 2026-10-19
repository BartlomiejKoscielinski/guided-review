import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { SummaryStatus } from '../types/SummaryStatus';
import { approvalStateKey } from './useApprovalState';
import { summaryStatusKey } from './useSummaryStatus';

export interface ApprovalActions {
  /** Approve MR for the reviewed head `sha`; settles once the tile has read the approval again. */
  approve: UseMutationResult<null, IpcError, string>;
  /** Revoke approval; settles once the tile has read the approval again. */
  revoke: UseMutationResult<null, IpcError, undefined>;
}

/**
 * Approve MR and Revoke approval of S-05 (F-14.2), each sent only by its own click. Nothing is
 * claimed before GitLab answers: the tile reads the approval again afterwards. A `CONFLICT` on
 * approve means the MR moved on since the review (GitLab's 409), so the summary shows the
 * MR-changed state (M5 decision 10a) instead of an error.
 */
export function useApprovalActions(sessionId: string): ApprovalActions {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const reread = () => queryClient.invalidateQueries({ queryKey: approvalStateKey(sessionId) });

  const approve = useMutation<null, IpcError, string>({
    mutationFn: async (sha) => {
      await ipc.gitlabApprove(sessionId, sha);
      await reread();
      return null;
    },
    onError: (error) => {
      if (error.code !== 'CONFLICT') return;
      queryClient.setQueryData<SummaryStatus>(summaryStatusKey(sessionId), (status) =>
        status ? { ...status, changed: true } : status,
      );
    },
  });

  const revoke = useMutation<null, IpcError, undefined>({
    mutationFn: async () => {
      await ipc.gitlabUnapprove(sessionId);
      await reread();
      return null;
    },
  });

  return { approve, revoke };
}
