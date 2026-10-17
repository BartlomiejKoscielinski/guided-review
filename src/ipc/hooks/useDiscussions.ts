import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { Thread } from '../types/Thread';

export const discussionsKey = (sessionId: string) => ['gitlab', 'discussions', sessionId] as const;

/**
 * The threads of the session's MR as GitLab has them now (S-05 "Threads N open", F-12.2), read
 * again each time the summary opens. `enabled` is false on a restored start, which calls no
 * GitLab command (F-30.4).
 */
export function useDiscussions(
  sessionId: string,
  enabled: boolean,
): UseQueryResult<Thread[], IpcError> {
  const ipc = useIpc();
  return useQuery<Thread[], IpcError>({
    queryKey: discussionsKey(sessionId),
    queryFn: () => ipc.gitlabDiscussions(sessionId),
    enabled: enabled && sessionId !== '',
  });
}
