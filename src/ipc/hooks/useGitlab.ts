import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import type { GitlabStatus } from '../types/GitlabStatus';
import type { MrList } from '../types/MrList';
import type { MrTab } from '../types/MrTab';
import { SETTINGS_KEY } from './useSettings';

export const GITLAB_STATUS_KEY = ['gitlab', 'status'] as const;
/** Every S-01 MR tab; refreshed when the active repository or the token changes. */
export const GITLAB_MRS_ROOT = ['gitlab', 'mrs'] as const;

/** Connected / no token / failing, with the masked token (F-19.2). */
export function useGitlabStatus(): UseQueryResult<GitlabStatus, IpcError> {
  const ipc = useIpc();
  return useQuery<GitlabStatus, IpcError>({
    queryKey: GITLAB_STATUS_KEY,
    queryFn: () => ipc.gitlabStatus(false),
  });
}

/**
 * One S-01 tab of the active repository's project, with the counts of all three (F-02.1).
 * Switching tabs keeps the previous list as placeholder data, so the counts stay visible.
 * Refetched when S-01 mounts or the window gains focus, and every `pollMs` (F-02.4).
 */
export function useMrList(
  tab: MrTab,
  enabled: boolean,
  pollMs: number | false,
): UseQueryResult<MrList, IpcError> {
  const ipc = useIpc();
  return useQuery<MrList, IpcError>({
    queryKey: [...GITLAB_MRS_ROOT, tab],
    queryFn: () => ipc.gitlabListMrs(tab),
    enabled,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    refetchInterval: pollMs,
  });
}

export interface GitlabAccountInput {
  server: string;
  token: string;
}

/**
 * Check and save / Replace token (F-19.5). `gcTime: 0` drops the finished mutation (its
 * variables hold the token) from the cache as soon as the caller resets it.
 */
export function useSaveGitlabAccount() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<GitlabStatus, IpcError, GitlabAccountInput>({
    mutationFn: ({ server, token }) => ipc.gitlabAccountSave(server, token),
    gcTime: 0,
    onSuccess: (status) => {
      queryClient.setQueryData(GITLAB_STATUS_KEY, status);
      void queryClient.invalidateQueries({ queryKey: GITLAB_MRS_ROOT });
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

/** Remove: the stored token goes, the server URL stays. */
export function useRemoveGitlabAccount() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<GitlabStatus, IpcError, undefined>({
    mutationFn: () => ipc.gitlabAccountRemove(),
    onSuccess: (status) => {
      queryClient.setQueryData(GITLAB_STATUS_KEY, status);
      void queryClient.invalidateQueries({ queryKey: GITLAB_MRS_ROOT });
    },
  });
}
