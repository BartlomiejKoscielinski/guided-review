import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useStartStore } from '../../state/start';
import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { CommitList } from '../types/CommitList';
import type { CommitRange } from '../types/CommitRange';
import type { DetectedSource } from '../types/DetectedSource';
import type { LocalScope } from '../types/LocalScope';
import type { OpenedSession } from '../types/OpenedSession';
import type { PrepareProgress } from '../types/PrepareProgress';
import type { StatusSummary } from '../types/StatusSummary';
import { LOCAL_KEY } from './useChanges';
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

/** The Commits column (F-03.1): the current branch, filtered by message, author or SHA. */
export function useCommitLog(
  query: string,
  enabled: boolean,
): UseQueryResult<CommitList, IpcError> {
  const ipc = useIpc();
  return useQuery<CommitList, IpcError>({
    queryKey: ['git', 'log', query],
    queryFn: () => ipc.gitLog(undefined, query === '' ? undefined : query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** The My changes column (F-03.3): counts of the three scopes; refreshed with the working tree. */
export function useStatusSummary(enabled: boolean): UseQueryResult<StatusSummary, IpcError> {
  const ipc = useIpc();
  return useQuery<StatusSummary, IpcError>({
    queryKey: [...LOCAL_KEY, 'summary'],
    queryFn: () => ipc.gitStatusSummary(),
    enabled,
  });
}

/** Review `<sha>` / `<from>..<to>` on S-01 (F-03.2). */
export function useOpenCommit() {
  const ipc = useIpc();
  return useMutation<OpenedSession, IpcError, CommitRange>({
    mutationFn: (range) => ipc.sessionOpenCommit(range),
  });
}

/** Review before push on S-01 (F-03.4). */
export function useOpenLocal() {
  const ipc = useIpc();
  return useMutation<OpenedSession, IpcError, LocalScope>({
    mutationFn: (scope) => ipc.sessionOpenLocal(scope),
  });
}
