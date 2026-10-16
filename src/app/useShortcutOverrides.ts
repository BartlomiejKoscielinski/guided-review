import { useEffect } from 'react';
import { useSettings } from '../ipc/hooks/useSettings';
import { changedShortcutKeys, useShortcutStore } from './shortcuts';

/**
 * Keeps the changed shortcuts of the saved settings (`ui.shortcuts`, F-19.7) in the shortcut
 * store, on start and whenever they change, so every key handler and hint uses them at once.
 * While the settings load or can't be read, the defaults apply.
 */
export function useShortcutOverrides(): void {
  const saved = useSettings().data?.ui.shortcuts;
  const setChanged = useShortcutStore((state) => state.setChanged);
  useEffect(() => {
    setChanged(changedShortcutKeys(saved));
  }, [saved, setChanged]);
}
