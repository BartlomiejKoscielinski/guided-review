import { useEffect, useRef } from 'react';
import { isRiderShortcut } from './keyboard';

/**
 * `Ctrl+Shift+O`: Open in Rider (F-24.1, F-30.6) on S-03 and S-04 at the current line and on S-06
 * at the shown file, as its Open in Rider button does. A chord works from a text field too, as
 * `Ctrl+D` does; a key the user gave it without Ctrl, Alt or Win (`R`, F-19.7) types there instead.
 * `open` is undefined while there is nothing to open.
 */
export function useRiderKey(open: (() => void) | undefined): void {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isRiderShortcut(event) || !latest.current) return;
      event.preventDefault();
      if (!event.repeat) latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
