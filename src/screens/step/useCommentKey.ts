import { useEffect, useRef } from 'react';
import { isTyping } from '../../app/keyboard';

/**
 * `C`: comment on the line (F-09.7, F-30.6). In a field the letter types; Ctrl+C copies and the
 * other Ctrl, Alt, Shift and Win combinations are left to others.
 */
export function useCommentKey(open: () => void): void {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.key.toLowerCase() !== 'c') return;
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
