import { useEffect } from 'react';
import { isNextStepShortcut, isTyping } from '../../app/keyboard';

/**
 * `]` opens the next step of the reader's order on S-04 (F-08.4). In a field the key types; on a
 * button it still moves on, since `]` presses nothing there. On the last step there is no next.
 */
export function useNextStepKey(next: string | undefined, go: (stepId: string) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isNextStepShortcut(event) || event.defaultPrevented) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      if (!event.repeat && next !== undefined) go(next);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [next, go]);
}
