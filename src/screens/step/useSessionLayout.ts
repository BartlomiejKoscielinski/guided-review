import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { sessionStateKey, type SessionStateWriter } from '../../ipc/hooks/useSessionState';
import { useUpdateSettings } from '../../ipc/hooks/useSettings';
import type { Layout } from '../../ipc/types/Layout';
import type { SessionState } from '../../ipc/types/SessionState';
import { useFocusStore } from '../../state/focus';

/**
 * S-03's layout per session and globally (F-04.3, F-07.1, F-07.9): the session's stored layout is
 * shown once its state arrives, and a layout the reader picks (Ctrl+1/2/3, the title bar's
 * switcher) is kept for the session and as `ui.focusLayout`, the layout new sessions open in.
 */
export function useSessionLayout(
  sessionId: string,
  stored: Layout | undefined,
  writer: SessionStateWriter,
): void {
  const queryClient = useQueryClient();
  const { mutate: saveSettings } = useUpdateSettings();
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
        if (kept === undefined || kept === layout) return;
        writer.setLayout(layout);
        saveSettings(
          { ui: { focusLayout: layout } },
          {
            onError: (error) => {
              console.error('The layout was not saved for new sessions.', error);
            },
          },
        );
      }),
    [queryClient, saveSettings, sessionId, writer],
  );
}
