import { useEffect } from 'react';
import { isTyping } from '../../app/keyboard';

/**
 * S-04's Guide aside keys (F-08.7): `N` the next note in line order, `A` the Ask box. In a field
 * the letters type; on a ticked checkbox they still work. Ctrl, Alt, Shift and Win combinations
 * are left to others.
 */
export function useGuideKeys(nextNote: () => void, focusAsk: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.metaKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        nextNote();
      } else if (key === 'a') {
        event.preventDefault();
        focusAsk();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [nextNote, focusAsk]);
}
