import { useCommitInfo } from '../../ipc/hooks/useChanges';
import { useSessionMr, useSessionSource } from '../../ipc/hooks/useSources';

/**
 * What the S-02 header (F-06.1, F-17.1) and the S-04 info header (F-08.2) show about a session:
 * the MR of an MR session, else its source and, for a single commit, that commit's author and
 * date. `session.data` is null for a session without an MR (a self-review).
 */
export function useSessionHeader(sessionId: string) {
  const session = useSessionMr(sessionId);
  const source = useSessionSource(sessionId, session.data === null);
  const single = source.data?.kind === 'commits' && source.data.from === undefined;
  const commit = useCommitInfo(
    source.data?.kind === 'commits' ? source.data.to : undefined,
    single,
  );
  return { session, source, single, commit };
}
