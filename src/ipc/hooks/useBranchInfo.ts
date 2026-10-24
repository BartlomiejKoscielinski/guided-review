import { useQuery } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { BranchInfo } from '../types/BranchInfo';
import { LOCAL_KEY } from './useChanges';

/**
 * The S-11 branch block (F-27.1) against `target`, the default target when undefined. Under the
 * local-changes key so a commit, push or repository switch reads it again. `enabled` false waits
 * for the user's choice of target.
 */
export function useBranchInfo(target: string | undefined, enabled = true) {
  const ipc = useIpc();
  return useQuery<BranchInfo, IpcError>({
    queryKey: [...LOCAL_KEY, 'branch-info', target ?? null],
    queryFn: () => ipc.gitBranchInfo(target),
    enabled,
  });
}
