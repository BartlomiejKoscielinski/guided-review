import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { AuthorMr } from '../types/AuthorMr';
import type { FileDiff } from '../types/FileDiff';

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
