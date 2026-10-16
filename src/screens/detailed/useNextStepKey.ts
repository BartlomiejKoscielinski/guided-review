import { useEffect } from 'react';
import { isNextStepShortcut, isTyping } from '../../app/keyboard';

/**
 * `]` opens the next step of the reader's order on S-04 (F-08.4); on the last step it finishes the
 * review and opens S-05 (F-30.3, M4 decision 11). In a field the key types; on a button or a
 * checkbox it still moves on, since `]` presses nothing there.
 */
export function useNextStepKey(
  next: string | undefined,
  go: (stepId: string) => void,
  finish: (() => void) | undefined,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isNextStepShortcut(event) || event.defaultPrevented) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (next !== undefined) go(next);
      else finish?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [next, go, finish]);
}
