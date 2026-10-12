import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useStartStore } from '../state/start';
import { pathFor, SETTINGS_ROUTE } from './routes';

/** Ctrl+, without Alt (so AltGr chords on Polish keyboards don't trigger it). */
export function isSettingsShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && event.key === ',';
}

/** Ctrl+K without Alt or Shift: S-01 with the input focused (F-01.4). */
export function isSourceShortcut(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    event.key.toLowerCase() === 'k'
  );
}

/**
 * App-wide shortcuts that work on every screen (F-30.6 › App group). `Ctrl+,` opens
 * Settings (F-19.4), `Ctrl+K` the S-01 input (F-01.4); the review shortcuts join with M3/M4.
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const requestFocus = useStartStore((s) => s.requestFocus);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSettingsShortcut(event)) {
        event.preventDefault();
        void navigate(pathFor(SETTINGS_ROUTE));
      } else if (isSourceShortcut(event)) {
        event.preventDefault();
        requestFocus();
        void navigate(pathFor({ screen: 'S-01' }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navigate, requestFocus]);
}
