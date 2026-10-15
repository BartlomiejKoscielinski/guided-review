import { useEffect, useRef } from 'react';
import type { LineSelection } from '../../ipc/types/LineSelection';
import { useReviewStore, useStepReview } from '../../state/review';
import { pickLine, pickedSelection } from './lineSelection';

/**
 * The step's selected lines (F-10.1): a click on a line number selects it, Shift+click extends
 * the selection on the same side of the same file, Esc and Clear drop it. Kept with the step's
 * state (`reviewKey`), so it survives layout and mode switches and the next step starts without
 * one.
 */
export function useLineSelection(key: string) {
  const picked = useStepReview(key, 'picked');
  const change = useReviewStore((s) => s.change);
  const selection: LineSelection | null = picked ? pickedSelection(picked) : null;
  // A Shift press not yet released or used by a click: extends like the click's own `shiftKey`
  // (synthetic clicks, as from assistive tools and test drivers, may carry no modifiers).
  const shift = useRef(false);

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shift.current = true;
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shift.current = false;
    };
    const onBlur = () => {
      shift.current = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    if (!picked) return;
    const onKey = (event: KeyboardEvent) => {
      // A menu or popover that closes on Esc has handled it already.
      if (event.key === 'Escape' && !event.defaultPrevented) change(key, () => ({ picked: null }));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [picked, change, key]);

  return {
    selection,
    pick: (at: { file: string; side: 'old' | 'new'; no: number }, extend: boolean) => {
      const range = extend || shift.current;
      shift.current = false;
      change(key, (s) => ({ picked: pickLine(s.picked, at, range) }));
    },
    clear: () => {
      change(key, () => ({ picked: null }));
    },
  };
}
