import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import type { ActiveRepo } from '../types/ActiveRepo';
import type { CommitInfo } from '../types/CommitInfo';
import type { CommitResult } from '../types/CommitResult';
import type { DiffSource } from '../types/DiffSource';
import type { FileDiff } from '../types/FileDiff';
import type { FileRef } from '../types/FileRef';
import type { LocalChanges } from '../types/LocalChanges';
import type { PushResult } from '../types/PushResult';
import type { Selection } from '../types/Selection';

export const REPO_KEY = ['repo', 'active'] as const;
/** Everything that reads the working tree or the index. */
export const LOCAL_KEY = ['git', 'local'] as const;
const STATUS_KEY = [...LOCAL_KEY, 'status'] as const;

export function useActiveRepo(): UseQueryResult<ActiveRepo | null, IpcError> {
  const ipc = useIpc();
  return useQuery<ActiveRepo | null, IpcError>({
    queryKey: REPO_KEY,
    queryFn: () => ipc.repoActive(),
  });
}

/** Folder dialog → default repository; refreshes everything that depends on it. */
export function usePickRepo() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<ActiveRepo | null, IpcError, undefined>({
    mutationFn: () => ipc.repoPick(),
    onSuccess: (repo) => {
      if (!repo) return;
      queryClient.setQueryData(REPO_KEY, repo);
      void queryClient.invalidateQueries({ queryKey: ['git'] });
    },
  });
}

export function useLocalChanges(enabled: boolean): UseQueryResult<LocalChanges, IpcError> {
  const ipc = useIpc();
  return useQuery<LocalChanges, IpcError>({
    queryKey: STATUS_KEY,
    queryFn: () => ipc.gitStatus(),
    enabled,
  });
}

export function useCommitInfo(
  sha: string | undefined,
  enabled: boolean,
): UseQueryResult<CommitInfo, IpcError> {
  const ipc = useIpc();
  return useQuery<CommitInfo, IpcError>({
    queryKey: ['git', 'commit', sha ?? 'HEAD'],
    queryFn: () => ipc.gitCommitInfo(sha),
    enabled,
  });
}

function diffKey(source: DiffSource, file: FileRef | null): readonly unknown[] {
  switch (source.kind) {
    case 'local':
      return [...LOCAL_KEY, 'diff', file?.path, file?.oldPath];
    case 'commit':
      return ['git', 'commit-diff', source.sha, file?.path];
    case 'session':
      return ['session', source.sessionId, 'diff', file?.path];
  }
}

export function useFileDiff(
  source: DiffSource,
  file: FileRef | null,
): UseQueryResult<FileDiff, IpcError> {
  const ipc = useIpc();
  return useQuery<FileDiff, IpcError>({
    queryKey: diffKey(source, file),
    queryFn: () => {
      if (!file) throw new Error('No file selected.');
      return ipc.gitFileDiff(source, file);
    },
    enabled: file !== null,
    placeholderData: (previous) => previous,
  });
}

/** Stage (true) or unstage (false) a selection; refetches the tree and the diffs. */
export function useStaging(): UseMutationResult<
  null,
  IpcError,
  { selection: Selection; stage: boolean }
> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<null, IpcError, { selection: Selection; stage: boolean }>({
    mutationFn: async ({ selection, stage }) => {
      await (stage ? ipc.gitStage(selection) : ipc.gitUnstage(selection));
      return null;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: LOCAL_KEY }),
  });
}

export function useCommit(): UseMutationResult<
  CommitResult,
  IpcError,
  { message: string; amend: boolean }
> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<CommitResult, IpcError, { message: string; amend: boolean }>({
    mutationFn: ({ message, amend }) => ipc.gitCommit(message, amend),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['git'] }),
  });
}

export function usePush() {
  const ipc = useIpc();
  return useMutation<PushResult, IpcError, undefined>({ mutationFn: () => ipc.gitPush() });
}

export function useLastMessage() {
  const ipc = useIpc();
  return useMutation<string | null, IpcError, undefined>({
    mutationFn: () => ipc.gitLastMessage(),
  });
}

export interface RiderTarget {
  file: string;
  line: number;
  session?: string;
}

/** Open in Rider; with `session`, a teammate's MR opens from `rider.openFrom`'s folder (F-24.1). */
export function useRiderOpen(): UseMutationResult<null, IpcError, RiderTarget> {
  const ipc = useIpc();
  return useMutation<null, IpcError, RiderTarget>({
    mutationFn: async ({ file, line, session }) => {
      await ipc.riderOpen(file, line, session);
      return null;
    },
  });
}

/** Refetches local changes when the working tree or the index changed outside (F-16.2). */
export function useRepoChangedRefresh(): void {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let live = true;
    void ipc
      .onRepoChanged(() => {
        void queryClient.invalidateQueries({ queryKey: LOCAL_KEY });
      })
      .then((stop) => {
        if (live) unsubscribe = stop;
        else stop();
      });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [ipc, queryClient]);
}
