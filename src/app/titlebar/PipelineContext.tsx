import { useMatches } from 'react-router';
import { useActiveRepo } from '../../ipc/hooks/useChanges';
import { ContextText } from './ContextText';
import { useCachedTitle } from './useCachedTitle';

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
