import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import type { UnfinishedSession } from '../types/UnfinishedSession';

/** Refreshed whenever `ui.lastRoute` is saved (useUpdateSettings), so the Review tile is current. */
export const UNFINISHED_KEY = ['sessions', 'unfinished'] as const;

/** Unfinished review sessions, most recent first; drives the Review dock tile (F-30.2). */
export function useUnfinishedSessions(): UseQueryResult<UnfinishedSession[], IpcError> {
  const ipc = useIpc();
  return useQuery<UnfinishedSession[], IpcError>({
    queryKey: UNFINISHED_KEY,
    queryFn: () => ipc.sessionsListUnfinished(),
  });
}
