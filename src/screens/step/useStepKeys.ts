import { useEffect, useRef } from 'react';
import { isNextStepShortcut, isPrevStepShortcut, isTyping } from '../../app/keyboard';

/**
 * `]` and `[` on S-03 and S-04 (F-08.4, F-30.6): `]` opens the next step of the reader's order, on
 * the last step it finishes the review and opens S-05 (F-30.3, M4 decision 11); `[` opens the
 * previous step and does nothing on the first. In a field the keys type; on a button or a checkbox
 * they still move, since they press nothing there.
 */
export function useStepKeys(
  prev: string | undefined,
  next: string | undefined,
  go: (stepId: string) => void,
  finish: (() => void) | undefined,
): void {
  const latest = useRef({ prev, next, go, finish });
  useEffect(() => {
    latest.current = { prev, next, go, finish };
  }, [prev, next, go, finish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const forward = isNextStepShortcut(event);
      if (!forward && !isPrevStepShortcut(event)) return;
      if (event.defaultPrevented || isTyping(event.target)) return;
      event.preventDefault();
      if (event.repeat) return;
      const keys = latest.current;
      const to = forward ? keys.next : keys.prev;
      if (to !== undefined) keys.go(to);
      else if (forward) keys.finish?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
