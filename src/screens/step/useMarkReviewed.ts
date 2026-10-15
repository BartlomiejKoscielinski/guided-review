import { useCallback, useEffect } from 'react';
import { isMarkReviewedShortcut, isTypingOrControl } from '../../app/keyboard';
import { useMarkStep } from '../../ipc/hooks/usePlan';

/**
 * Mark reviewed and its undo on the step S-03 shows (F-07.2): what the button does in each layout
 * (A's header, B's toolbar, C's guide panel) and Space. In a field or on a control Space keeps its
 * own meaning (typing, pressing what has the focus); elsewhere it toggles the mark and doesn't
 * scroll the page. Until the step is there (`reviewed` undefined) there is nothing to mark.
 */
export function useMarkReviewed(
  sessionId: string,
  stepId: string,
  reviewed: boolean | undefined,
): () => void {
  const { mutate } = useMarkStep(sessionId);
  const toggle = useCallback(() => {
    if (reviewed !== undefined) mutate({ stepId, reviewed: !reviewed });
  }, [mutate, stepId, reviewed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isMarkReviewedShortcut(event) || event.defaultPrevented) return;
      if (isTypingOrControl(event.target)) return;
      event.preventDefault();
      if (!event.repeat) toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [toggle]);

  return toggle;
}
