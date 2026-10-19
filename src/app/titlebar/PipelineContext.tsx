import { useQueryClient } from '@tanstack/react-query';
import { useMatches } from 'react-router';
import { useActiveRepo } from '../../ipc/hooks/useChanges';
import { GITLAB_MRS_ROOT } from '../../ipc/hooks/useGitlab';
import type { MrList } from '../../ipc/types/MrList';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { ContextText } from './ContextText';

/** The title of MR `iid` from what S-01 or a review screen already read; no new call. */
function useCachedTitle(iid: number): string | undefined {
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

/**
 * S-08 title-bar context (F-30.1): the repository, `!iid` from the route and the MR's title when
 * S-01 or the review already read it. It reads no GitLab, so a restored start stays quiet (F-30.4).
 */
export function PipelineContext() {
  const iid = Number(useMatches().at(-1)?.params.iid ?? Number.NaN);
  const repo = useActiveRepo();
  const title = useCachedTitle(iid);
  return (
    <>
      {repo.data && <ContextText kind="repo">{repo.data.name}</ContextText>}
      {Number.isFinite(iid) && <ContextText kind="iid">{`!${String(iid)}`}</ContextText>}
      {title !== undefined && <ContextText kind="title">{title}</ContextText>}
    </>
  );
}
