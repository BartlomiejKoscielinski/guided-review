import { Tag } from '../../components/Tag';
import { useActiveRepo } from '../../ipc/hooks/useChanges';
import { useRouteAuthorMr } from '../../screens/author/useRouteAuthorMr';
import { ContextText } from './ContextText';
import { useCachedTitle } from './useCachedTitle';

/**
 * S-10 title-bar context (F-26.1): the repository, my `!iid`, the MR's title (from `authorMr`, or
 * from what S-01 already read on a restored start) and the blue tag "You’re the author".
 */
export function AuthorContext() {
  const { iid, mr } = useRouteAuthorMr();
  const repo = useActiveRepo();
  const cached = useCachedTitle(iid);
  const title = mr.data?.title ?? cached;
  return (
    <>
      {repo.data && <ContextText kind="repo">{repo.data.name}</ContextText>}
      {Number.isFinite(iid) && (
        <ContextText kind="iid" mine>
          {`!${String(iid)}`}
        </ContextText>
      )}
      {title !== undefined && <ContextText kind="title">{title}</ContextText>}
      <Tag color="blue">You’re the author</Tag>
    </>
  );
}
