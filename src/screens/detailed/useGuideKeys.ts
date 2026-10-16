import { useEffect } from 'react';
import { isTyping } from '../../app/keyboard';
import { isShortcutKey } from '../../app/shortcuts';

/**
 * S-04's Guide aside keys (F-08.7), read from the shortcuts table (F-30.6; F-19.7 edits it): Next
 * note (`N`) the next note in line order, Ask Claude (`A`) the Ask box. In a field the letters
 * type; on a ticked checkbox they still work. Ctrl, Alt, Shift and Win combinations are left to
 * others.
 */
export function useGuideKeys(nextNote: () => void, focusAsk: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target)) return;
      if (isShortcutKey(event, 'nextNote')) {
        event.preventDefault();
        nextNote();
      } else if (isShortcutKey(event, 'ask')) {
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
