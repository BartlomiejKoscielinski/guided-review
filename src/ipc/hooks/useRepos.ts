import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import type { ActiveRepo } from '../types/ActiveRepo';
import type { Repo } from '../types/Repo';
import { GITLAB_MRS_ROOT } from './useGitlab';

/** Everything about the configured repositories (`['repo', 'active']` included). */
const REPOS_ROOT = ['repo'] as const;
export const REPO_LIST_KEY = ['repo', 'list'] as const;

/** The configured repositories (F-19.6). */
export function useRepos(): UseQueryResult<Repo[], IpcError> {
  const ipc = useIpc();
  return useQuery<Repo[], IpcError>({
    queryKey: REPO_LIST_KEY,
    queryFn: () => ipc.repoList(),
  });
}

/** Refreshes the list, the active repository and what reads it (working tree, MR lists). */
function useInvalidateRepos(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: REPOS_ROOT });
    void queryClient.invalidateQueries({ queryKey: ['git'] });
    void queryClient.invalidateQueries({ queryKey: GITLAB_MRS_ROOT });
  };
}

/** Add repository: folder dialog; null when cancelled. */
export function useAddRepo() {
  const ipc = useIpc();
  const invalidate = useInvalidateRepos();
  return useMutation<ActiveRepo | null, IpcError, undefined>({
    mutationFn: () => ipc.repoPick(),
    onSuccess: (repo) => {
      if (repo) invalidate();
    },
  });
}

/** Title-bar switcher: the active repository of S-01 and S-06 until the app restarts (F-30.7). */
export function useSwitchRepo() {
  const ipc = useIpc();
  const invalidate = useInvalidateRepos();
  return useMutation<ActiveRepo, IpcError, number>({
    mutationFn: (id) => ipc.repoSwitch(id),
    onSuccess: invalidate,
  });
}

export function useSetDefaultRepo() {
  const ipc = useIpc();
  const invalidate = useInvalidateRepos();
  return useMutation<null, IpcError, number>({
    mutationFn: async (id) => {
      await ipc.repoSetDefault(id);
      return null;
    },
    onSuccess: invalidate,
  });
}

/** Remove: forgets the repository; nothing on disk changes. */
export function useRemoveRepo() {
  const ipc = useIpc();
  const invalidate = useInvalidateRepos();
  return useMutation<null, IpcError, number>({
    mutationFn: async (id) => {
      await ipc.repoRemove(id);
      return null;
    },
    onSuccess: invalidate,
  });
}
