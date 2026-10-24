import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { MergeCheck } from '../types/MergeCheck';
import type { PushResult } from '../types/PushResult';
import { LOCAL_KEY } from './useChanges';

/**
 * S-11's "Before you create" (F-27.5) against `target`, the default target when undefined. Under
 * the local-changes key so a commit, push or repository switch reads it again; another target
 * keeps the previous checks on screen until its own arrive.
 */
export function useMergeCheck(target: string | undefined, enabled = true) {
  const ipc = useIpc();
  return useQuery<MergeCheck, IpcError>({
    queryKey: [...LOCAL_KEY, 'merge-check', target ?? null],
    queryFn: () => ipc.gitMergeCheck(target),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** **Push now** of "Before you create": the push, then the checks (and the branch block) again. */
export function usePushForChecks() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<PushResult, IpcError, undefined>({
    mutationFn: async () => {
      const result = await ipc.gitPush();
      await queryClient.invalidateQueries({ queryKey: LOCAL_KEY });
      return result;
    },
  });
}
