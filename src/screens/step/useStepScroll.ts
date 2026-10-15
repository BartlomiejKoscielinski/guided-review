import { useEffect, useRef, type RefObject } from 'react';

/** How long scrolling has to pause before the position is written (F-04.3). */
export const SCROLL_SAVE_MS = 300;

/**
 * Keeps where a step was scrolled (F-04.3). Once the step and its notes are shown (`ready`),
 * `main` goes to the stored position - the top for a step never scrolled - unless the reader
 * scrolled first; from then on each position is written when scrolling pauses, and a pending
 * one when the step closes. The step body is keyed by step, so this runs once per step.
 *
 * The position is set in the frame after the step is drawn: the diff's virtualizers attach to
 * `main` in their own effects and move it to the offset they last saw.
 */
export function useStepScroll(
  mainRef: RefObject<HTMLElement | null>,
  ready: boolean,
  stored: number,
  save: (top: number) => void,
): void {
  const restored = useRef(false);
  const last = useRef<number | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    const main = mainRef.current;
    if (!ready || restored.current || !main) return undefined;
    const frame = requestAnimationFrame(() => {
      if (restored.current) return;
      restored.current = true;
      last.current = stored;
      main.scrollTop = stored;
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [mainRef, ready, stored]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: number | null = null;
    const flush = () => {
      clearTimeout(timer);
      if (pending === null) return;
      const top = pending;
      pending = null;
      if (top === last.current) return;
      last.current = top;
      saveRef.current(top);
    };
    const onScroll = () => {
      if (!restored.current) {
        if (main.scrollTop <= 0) return;
        // The reader scrolled before the step was ready: their position wins.
        restored.current = true;
      }
      pending = main.scrollTop;
      clearTimeout(timer);
      timer = setTimeout(flush, SCROLL_SAVE_MS);
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', onScroll);
      flush();
    };
  }, [mainRef]);
}
