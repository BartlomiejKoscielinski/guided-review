import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { AuthorMr } from '../types/AuthorMr';
import type { CommitResult } from '../types/CommitResult';
import type { FileDiff } from '../types/FileDiff';
import type { FixupTarget } from '../types/FixupTarget';
import type { PushOutcome } from '../types/PushOutcome';
import type { QueuedReply } from '../types/QueuedReply';

export const authorMrKey = (project: string, iid: number) =>
  ['gitlab', 'author-mr', project, iid] as const;

/**
 * S-10's MR (F-26.1): title, branches, head pipeline and thread list. `enabled` is false on a
 * restored start and until the project is known (F-30.4).
 */
export function useAuthorMr(
  project: string | undefined,
  iid: number,
  enabled: boolean,
): UseQueryResult<AuthorMr, IpcError> {
  const ipc = useIpc();
  return useQuery<AuthorMr, IpcError>({
    queryKey: authorMrKey(project ?? '', iid),
    queryFn: () => ipc.authorMr(project ?? '', iid),
    enabled: enabled && project !== undefined && project !== '' && Number.isFinite(iid),
  });
}

export const authorFileDiffKey = (target: string, path: string) =>
  ['git', 'author-file-diff', target, path] as const;

/**
 * The selected thread's file in S-10 (F-26.2): merge-base(origin/`target`, HEAD) → working tree.
 * Not read for a General thread (`path` null).
 */
export function useAuthorFileDiff(
  target: string,
  path: string | null,
): UseQueryResult<FileDiff, IpcError> {
  const ipc = useIpc();
  return useQuery<FileDiff, IpcError>({
    queryKey: authorFileDiffKey(target, path ?? ''),
    queryFn: () => ipc.authorFileDiff(target, path ?? ''),
    enabled: path !== null && path !== '',
  });
}

/**
 * The commit a fix of the thread is a fixup of (F-26.4, M7 decision 8); read once the panel shows
 * (`enabled`). `line` null: a removed line or an outdated position.
 */
export function useAuthorFixupTarget(
  target: string,
  path: string,
  line: number | null,
  enabled: boolean,
): UseQueryResult<FixupTarget, IpcError> {
  const ipc = useIpc();
  return useQuery<FixupTarget, IpcError>({
    queryKey: ['git', 'author-fixup-target', target, path, line],
    queryFn: () => ipc.authorFixupTarget(target, path, line),
    enabled,
  });
}

export interface AuthorCommitInput {
  message: string;
  /** The full SHA of the fixup target, or null for a separate commit. */
  fixup: string | null;
  path: string;
}

/** **Commit** on S-10 (F-26.4, M7 decision 10): the fixed file alone, never an amend. */
export function useAuthorCommit(): UseMutationResult<CommitResult, IpcError, AuthorCommitInput> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<CommitResult, IpcError, AuthorCommitInput>({
    mutationFn: ({ message, fixup, path }) => ipc.gitCommit(message, false, fixup, [path]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['git'] }),
  });
}

export interface AuthorReplyInput {
  project: string;
  iid: number;
  discussion: string;
  /** "Fixed in <sha>. <one sentence>." as the box shows it. */
  body: string;
  resolve: boolean;
  /** The full SHA of the commit the reply names. */
  afterSha: string;
}

/** Callbacks run even when the panel is gone by then (another thread was picked). */
export interface AuthorReplyCallbacks<T> {
  onMutate?: (input: AuthorReplyInput) => void;
  onSuccess?: (result: T, input: AuthorReplyInput) => void;
  onError?: (error: IpcError, input: AuthorReplyInput) => void;
}

/**
 * Queues the reply after **Commit** (F-26.5); sends nothing. The thread then reads "Fixed locally
 * · not pushed".
 */
export function useAuthorQueueReply(
  on: AuthorReplyCallbacks<QueuedReply> = {},
): UseMutationResult<QueuedReply, IpcError, AuthorReplyInput> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<QueuedReply, IpcError, AuthorReplyInput>({
    mutationFn: (v) =>
      ipc.authorQueueReply(v.project, v.iid, v.discussion, v.body, v.resolve, v.afterSha),
    onSuccess: on.onSuccess,
    onError: on.onError,
    onSettled: (_r, _e, v) =>
      queryClient.invalidateQueries({ queryKey: authorMrKey(v.project, v.iid) }),
  });
}

/**
 * **Push and reply** and **Retry** (F-26.5): queues the reply as the box and the switch show it,
 * then pushes and sends it; only on the click.
 */
export function useAuthorPushAndReply(
  on: AuthorReplyCallbacks<PushOutcome> = {},
): UseMutationResult<PushOutcome, IpcError, AuthorReplyInput> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<PushOutcome, IpcError, AuthorReplyInput>({
    mutationFn: async (v) => {
      const queued = await ipc.authorQueueReply(
        v.project,
        v.iid,
        v.discussion,
        v.body,
        v.resolve,
        v.afterSha,
      );
      return ipc.authorPushAndReply(v.project, v.iid, queued.id);
    },
    onMutate: on.onMutate,
    onSuccess: on.onSuccess,
    onError: on.onError,
    onSettled: async (_r, _e, v) => {
      await queryClient.invalidateQueries({ queryKey: authorMrKey(v.project, v.iid) });
      await queryClient.invalidateQueries({ queryKey: ['git'] });
    },
  });
}
