import { useQuery } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import { LOCAL_KEY } from './useChanges';

/**
 * The title S-11 opens with for an MR into `target` (F-27.2, read from the commits without
 * Claude), the default target when undefined. Under the local-changes key like the branch block,
 * so a commit, push or repository switch reads it again.
 */
export function useMrTitle(target: string | undefined) {
  const ipc = useIpc();
  return useQuery<string, IpcError>({
    queryKey: [...LOCAL_KEY, 'mr-title', target ?? null],
    queryFn: () => ipc.gitMrTitle(target),
  });
}
