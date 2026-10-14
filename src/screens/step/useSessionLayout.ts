import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { sessionStateKey, type SessionStateWriter } from '../../ipc/hooks/useSessionState';
import type { Layout } from '../../ipc/types/Layout';
import type { SessionState } from '../../ipc/types/SessionState';
import { useFocusStore } from '../../state/focus';

/**
 * S-03's layout per session (F-04.3, F-07.1): the session's stored layout is shown once its
 * state arrives, and a layout the reader picks (Ctrl+1/2/3, the title bar's switcher) is kept.
 */
export function useSessionLayout(
  sessionId: string,
  stored: Layout | undefined,
  writer: SessionStateWriter,
): void {
  const queryClient = useQueryClient();
  const appliedFor = useRef<string | null>(null);

  useEffect(() => {
    if (stored === undefined || appliedFor.current === sessionId) return;
    appliedFor.current = sessionId;
    useFocusStore.getState().setLayout(stored);
  }, [sessionId, stored]);

  useEffect(
    () =>
      useFocusStore.subscribe(({ layout }) => {
        if (appliedFor.current !== sessionId) return;
        const kept = queryClient.getQueryData<SessionState>(sessionStateKey(sessionId))?.layout;
        if (kept !== undefined && kept !== layout) writer.setLayout(layout);
      }),
    [queryClient, sessionId, writer],
  );
}
