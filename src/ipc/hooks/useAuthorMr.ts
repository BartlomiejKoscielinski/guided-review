import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { AuthorMr } from '../types/AuthorMr';

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
