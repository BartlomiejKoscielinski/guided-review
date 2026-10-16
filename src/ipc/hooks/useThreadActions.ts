import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import { stepsKey } from './useReview';

export interface ResolveInput {
  discussion: string;
  resolved: boolean;
}

export interface ReplyInput {
  discussion: string;
  body: string;
}

/**
 * Resolve or Reopen one thread (F-11.2): sent to GitLab at once, independent of drafts and
 * approval. It settles only once the step shows the new state, so nothing claims Resolved before
 * GitLab has it; the step queries are the only ones refetched (no Claude work, no drafts).
 */
export function useResolveThread(
  sessionId: string,
): UseMutationResult<undefined, IpcError, ResolveInput> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<undefined, IpcError, ResolveInput>({
    mutationFn: async ({ discussion, resolved }) => {
      await ipc.gitlabResolve(sessionId, discussion, resolved);
      return undefined;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: stepsKey(sessionId) }),
  });
}

/** Reply to one thread (F-11.2, M5 decision 1): a note of the thread at once, not a draft. */
export function useReplyThread(
  sessionId: string,
): UseMutationResult<undefined, IpcError, ReplyInput> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<undefined, IpcError, ReplyInput>({
    mutationFn: async ({ discussion, body }) => {
      await ipc.gitlabReply(sessionId, discussion, body);
      return undefined;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: stepsKey(sessionId) }),
  });
}
