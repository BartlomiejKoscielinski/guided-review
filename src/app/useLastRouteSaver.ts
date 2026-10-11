import { useEffect, useRef } from 'react';
import { useUpdateSettings } from '../ipc/hooks/useSettings';
import type { Route } from '../ipc/types/Route';

/**
 * Saves the current screen as `ui.lastRoute` whenever it changes (F-30.4). The screen the app
 * started on is not written again.
 */
export function useLastRouteSaver(route: Route | null): void {
  const { mutate } = useUpdateSettings();
  const key = route ? JSON.stringify(route) : null;
  const saved = useRef(key);
  useEffect(() => {
    if (key === null || key === saved.current) return;
    saved.current = key;
    mutate({ ui: { lastRoute: JSON.parse(key) as Route } });
  }, [key, mutate]);
}
