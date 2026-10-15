import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { PREPARING_PATH } from '../../app/routes';
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
import type { SessionMr } from '../types/SessionMr';
import type { Source } from '../types/Source';
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
 * opens it. An MR reports its preparation to the start store; once GitLab knows the MR (the first
 * stage), the app shows S-02 Preparing, which takes over: it opens the plan, shows a failure or
 * cancels (F-05.6). Before that, errors (F-01.5) stay with the caller on S-01.
 */
export function useOpenSource() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
      if (source.kind !== 'mr') return openDetected(ipc, source, task, () => undefined);
      const { prepareStarted, prepareProgress, prepareFinished, prepareCleared } =
        useStartStore.getState();
      prepareStarted(task, source.iid);
      // Whether S-02 Preparing took over; set in the progress callback (an object, so TS sees it).
      const view = { shown: false };
      try {
        const opened = await openDetected(ipc, source, task, (progress) => {
          prepareProgress(task, progress);
          if (!view.shown) {
            view.shown = true;
            void navigate(PREPARING_PATH);
          }
        });
        if (view.shown) prepareFinished(task, { kind: 'opened', route: opened.route });
        else prepareCleared(task);
        return opened;
      } catch (error) {
        const cancelled = error instanceof IpcError && error.code === 'CANCELLED';
        if (view.shown && !cancelled) {
          const message = error instanceof IpcError ? error.message : 'Preparation failed.';
          prepareFinished(task, { kind: 'failed', message });
        } else {
          prepareCleared(task);
        }
        throw error;
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

/** S-02 / S-06 MR browse: a teammate's MR session as prepared; null for other sessions. */
export function useSessionMr(sessionId: string): UseQueryResult<SessionMr | null, IpcError> {
  const ipc = useIpc();
  return useQuery<SessionMr | null, IpcError>({
    queryKey: ['session', sessionId, 'mr'],
    queryFn: () => ipc.sessionMr(sessionId),
  });
}

/** S-02: what a session reviews (F-17.1), for the header of a session without an MR. */
export function useSessionSource(
  sessionId: string,
  enabled: boolean,
): UseQueryResult<Source, IpcError> {
  const ipc = useIpc();
  return useQuery<Source, IpcError>({
    queryKey: ['session', sessionId, 'source'],
    queryFn: () => ipc.sessionSource(sessionId),
    enabled,
  });
}

/** Cancel on S-02 Preparing (F-05.6): stops the preparation; the caller goes back to S-01. */
export function useCancelPreparation() {
  const ipc = useIpc();
  const prepareCleared = useStartStore((s) => s.prepareCleared);
  return (task: string) => {
    prepareCleared(task);
    void ipc.sessionPrepareCancel(task);
  };
}
