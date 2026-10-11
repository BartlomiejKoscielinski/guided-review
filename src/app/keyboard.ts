import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { pathFor, SETTINGS_ROUTE } from './routes';

/** Ctrl+, without Alt (so AltGr chords on Polish keyboards don't trigger it). */
export function isSettingsShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && event.key === ',';
}

/**
 * App-wide shortcuts that work on every screen (F-30.6 › App group). M0: `Ctrl+,` opens
 * Settings (F-19.4). `Ctrl+K` and the review shortcuts join with their milestones.
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSettingsShortcut(event)) {
        event.preventDefault();
        void navigate(pathFor(SETTINGS_ROUTE));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navigate]);
}
