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
 * What a thread action reports once it settles. These run as the mutation's own callbacks, so
 * they run even when the card that sent it is gone meanwhile (the diff's virtual list unmounts a
 * card scrolled out of view); a callback given to `mutate` would not.
 */
export interface ThreadActionReport<V> {
  onSuccess?: (input: V) => void;
  onError?: (error: IpcError, input: V) => void;
}

/**
 * Resolve or Reopen one thread (F-11.2): sent to GitLab at once, independent of drafts and
 * approval. It settles only once the step shows the new state, so nothing claims Resolved before
 * GitLab has it; the step queries are the only ones refetched (no Claude work, no drafts).
 */
export function useResolveThread(
  sessionId: string,
  report: ThreadActionReport<ResolveInput> = {},
): UseMutationResult<undefined, IpcError, ResolveInput> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<undefined, IpcError, ResolveInput>({
    mutationFn: async ({ discussion, resolved }) => {
      await ipc.gitlabResolve(sessionId, discussion, resolved);
      return undefined;
    },
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: stepsKey(sessionId) });
      report.onSuccess?.(input);
    },
    onError: (error, input) => {
      report.onError?.(error, input);
    },
  });
}

/** Reply to one thread (F-11.2, M5 decision 1): a note of the thread at once, not a draft. */
export function useReplyThread(
  sessionId: string,
  report: ThreadActionReport<ReplyInput> = {},
): UseMutationResult<undefined, IpcError, ReplyInput> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<undefined, IpcError, ReplyInput>({
    mutationFn: async ({ discussion, body }) => {
      await ipc.gitlabReply(sessionId, discussion, body);
      return undefined;
    },
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: stepsKey(sessionId) });
      report.onSuccess?.(input);
    },
    onError: (error, input) => {
      report.onError?.(error, input);
    },
  });
}
