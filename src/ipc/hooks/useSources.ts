import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useStartStore } from '../../state/start';
import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { DetectedSource } from '../types/DetectedSource';
import type { OpenedSession } from '../types/OpenedSession';
import type { PrepareProgress } from '../types/PrepareProgress';
import { GITLAB_MRS_ROOT } from './useGitlab';

const detectKey = (input: string) => ['source', 'detect', input] as const;

/** What the S-01 input names (F-01.2); rejects with the F-01.5 copy. Blank input: no query. */
export function useSourceDetect(input: string): UseQueryResult<DetectedSource | null, IpcError> {
  const ipc = useIpc();
  return useQuery<DetectedSource | null, IpcError>({
    queryKey: detectKey(input),
    queryFn: () => ipc.sourceDetect(input),
    enabled: input !== '',
  });
}

let tasks = 0;

/** Opens a detected source with the matching `session_open_*` command (F-01.3). */
function openDetected(
  ipc: IpcClient,
  source: DetectedSource,
  task: string,
  onProgress: (progress: PrepareProgress) => void,
): Promise<OpenedSession> {
  switch (source.kind) {
    case 'mr':
      return ipc.sessionOpenMr(source.iid, source.project, task, onProgress);
    case 'commit':
      return ipc.sessionOpenCommit({ to: source.sha });
    case 'branch':
      return ipc.sessionOpenBranch(source.name);
    case 'repository':
      return ipc.sessionOpenRepo(source.path);
  }
}

/**
 * Enter / Start on S-01 (F-01.3): detects the (trimmed) input unless it is already known, then
 * opens it. An MR reports its preparation stages to the start store (S-02 Preparing, F-05.6).
 */
export function useOpenSource() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const setPreparing = useStartStore((s) => s.setPreparing);
  return useMutation<OpenedSession, IpcError, string>({
    mutationFn: async (input) => {
      const source = await queryClient.query<DetectedSource | null, IpcError>({
        queryKey: detectKey(input),
        queryFn: () => ipc.sourceDetect(input),
      });
      if (!source) {
        throw new IpcError({
          code: 'INVALID_INPUT',
          message: 'Nothing to open.',
          retryable: false,
        });
      }
      tasks += 1;
      const task = `prepare-${String(tasks)}`;
      if (source.kind === 'mr') setPreparing({ task, progress: null });
      try {
        return await openDetected(ipc, source, task, (progress) => {
          setPreparing({ task, progress });
        });
      } finally {
        if (source.kind === 'mr') setPreparing(null);
      }
    },
    // An MR of another repository switches to it; a typed path adds one (F-01.5, F-30.7).
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['repo'] });
      void queryClient.invalidateQueries({ queryKey: ['git'] });
      void queryClient.invalidateQueries({ queryKey: GITLAB_MRS_ROOT });
    },
  });
}
