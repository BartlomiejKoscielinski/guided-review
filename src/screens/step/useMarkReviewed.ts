import { useCallback } from 'react';
import { useMarkStep } from '../../ipc/hooks/useMarks';

/**
 * Mark reviewed and its undo on the step S-03 or S-04 shows (F-07.2): what the button does in
 * each layout (A's header, B's toolbar, C's guide panel, S-04's step header). On a step that is
 * not reviewed it marks all its files, on a reviewed one it takes them all back (F-07.10); Space
 * is the current file's (`useFileMarks`). Until the step is there (`reviewed` undefined) there is
 * nothing to mark.
 */
export function useMarkReviewed(
  sessionId: string,
  stepId: string,
  reviewed: boolean | undefined,
): () => void {
  const { mutate } = useMarkStep(sessionId);
  return useCallback(() => {
    if (reviewed !== undefined) mutate({ stepId, reviewed: !reviewed });
  }, [mutate, stepId, reviewed]);
}
