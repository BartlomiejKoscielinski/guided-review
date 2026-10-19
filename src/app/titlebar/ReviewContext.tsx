import { useMatches } from 'react-router';
import { useActiveRepo } from '../../ipc/hooks/useChanges';
import { useSessionMr } from '../../ipc/hooks/useSources';
import { ContextText } from './ContextText';

/**
 * S-03 and S-05 title-bar context (F-30.1): the repository (plain text, as on S-02), then `!iid` and the
 * title of the session's MR. Commit and local sessions have no MR, so only the repository shows.
 */
export function ReviewContext() {
  const sessionId = useMatches().at(-1)?.params.sessionId ?? '';
  const repo = useActiveRepo();
  const mr = useSessionMr(sessionId).data?.mr;
  return (
    <>
      {repo.data && <ContextText kind="repo">{repo.data.name}</ContextText>}
      {mr && (
        <>
          <ContextText kind="iid">{`!${String(mr.iid)}`}</ContextText>
          <ContextText kind="title">{mr.title}</ContextText>
        </>
      )}
    </>
  );
}
