import { useMatches } from 'react-router';
import { useActiveRepo } from '../../ipc/hooks/useChanges';
import { useSessionMr } from '../../ipc/hooks/useSources';
import { useStartStore } from '../../state/start';
import { ContextText } from './ContextText';

function MrIid({ sessionId }: { sessionId: string }) {
  const session = useSessionMr(sessionId);
  const iid = session.data?.mr.iid;
  return iid === undefined ? null : <ContextText kind="iid">{`!${String(iid)}`}</ContextText>;
}

/**
 * S-02 title-bar context: the repository (plain text; opening an MR made it the active one),
 * `!iid` of the MR being prepared or reviewed, "Review plan".
 */
export function PlanContext() {
  const matches = useMatches();
  const sessionId = matches.at(-1)?.params.sessionId;
  const repo = useActiveRepo();
  const preparing = useStartStore((s) => s.preparing);
  return (
    <>
      {repo.data && <ContextText kind="repo">{repo.data.name}</ContextText>}
      {sessionId ? (
        <MrIid sessionId={sessionId} />
      ) : (
        preparing && <ContextText kind="iid">{`!${String(preparing.iid)}`}</ContextText>
      )}
      <ContextText kind="label">Review plan</ContextText>
    </>
  );
}
