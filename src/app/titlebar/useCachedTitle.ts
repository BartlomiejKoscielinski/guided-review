import { useQueryClient } from '@tanstack/react-query';
import { GITLAB_MRS_ROOT } from '../../ipc/hooks/useGitlab';
import type { MrList } from '../../ipc/types/MrList';
import type { SessionMr } from '../../ipc/types/SessionMr';

/** The title of MR `iid` from what S-01 or a review screen already read; no new call. */
export function useCachedTitle(iid: number): string | undefined {
  const queryClient = useQueryClient();
  const fromLists = queryClient
    .getQueriesData<MrList>({ queryKey: GITLAB_MRS_ROOT })
    .flatMap(([, list]) => list?.rows ?? [])
    .find((row) => row.iid === iid)?.title;
  if (fromLists !== undefined) return fromLists;
  return queryClient
    .getQueriesData<SessionMr | null>({ queryKey: ['session'] })
    .map(([, data]) => (data && typeof data === 'object' && 'mr' in data ? data.mr : null))
    .find((mr) => mr?.iid === iid)?.title;
}
