import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import type { ActiveRepo } from '../types/ActiveRepo';
import type { Repo } from '../types/Repo';

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

/** Refreshes the list, the active repository and what reads its working tree. */
function useInvalidateRepos(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: REPOS_ROOT });
    void queryClient.invalidateQueries({ queryKey: ['git'] });
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
