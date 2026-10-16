import { useMemo } from 'react';
import { useReplyThread, useResolveThread } from '../../ipc/hooks/useThreadActions';
import {
  NO_THREAD_CARD,
  reviewKey,
  useReviewStore,
  type StepReview,
  type ThreadCardState,
} from '../../state/review';

/** The step a thread card is shown on: its state is kept with that step's (`state/review.ts`). */
export interface ThreadScope {
  sessionId: string;
  stepId: string;
}

export interface ThreadCardActions {
  /** Reply: the composer opens empty and takes the focus. */
  open: () => void;
  /** Cancel or Esc: the composer closes and its text is dropped. */
  close: () => void;
  /** The text in the composer as the reader types it. */
  type: (text: string) => void;
  /** The composer took the focus it was opened with: a later remount leaves the focus alone. */
  focused: () => void;
  /**
   * Resolve (true) or Reopen (false) at once. `done` runs once GitLab has it and the card shows
   * the new state, only if the card is still shown.
   */
  setResolved: (resolved: boolean, done: () => void) => void;
  /** Sends the reply at once; `done` as for `setResolved`. */
  reply: (body: string, done: () => void) => void;
}

const patchCard =
  (discussion: string, patch: Partial<ThreadCardState>) =>
  (s: StepReview): Partial<StepReview> => ({
    threadCards: {
      ...s.threadCards,
      [discussion]: { ...(s.threadCards[discussion] ?? NO_THREAD_CARD), ...patch },
    },
  });

/**
 * One thread card's actions and state (F-11.2, M5 decisions 1 and 2). The open composer, its
 * text, the calls in flight and the last error live with the step's state, not in the card, so
 * a card the diff's virtual list unmounts (scrolled out of view) or the reader closes with its
 * gutter icon comes back as it was, and a call that settles meanwhile still lands its result.
 */
export function useThreadCard(
  { sessionId, stepId }: ThreadScope,
  discussion: string,
): ThreadCardState & ThreadCardActions {
  const key = reviewKey(sessionId, stepId);
  const state =
    useReviewStore((s) => (s.key === key ? s.threadCards[discussion] : undefined)) ??
    NO_THREAD_CARD;
  const change = useReviewStore((s) => s.change);
  const follow = useReviewStore((s) => s.follow);
  // Results land with the step they were sent on, dropped once the reader opened another step.
  const resolve = useResolveThread(sessionId, {
    onSuccess: (input) => {
      follow(key, patchCard(input.discussion, { resolving: false }));
    },
    onError: (error, input) => {
      const what = input.resolved ? 'resolve the thread' : 'reopen the thread';
      follow(
        key,
        patchCard(input.discussion, {
          resolving: false,
          error: `Couldn't ${what}. ${error.message}`,
        }),
      );
    },
  });
  const send = useReplyThread(sessionId, {
    onSuccess: (input) => {
      follow(
        key,
        patchCard(input.discussion, { sending: false, composing: false, text: '', focus: false }),
      );
    },
    onError: (error, input) => {
      follow(
        key,
        patchCard(input.discussion, {
          sending: false,
          error: `Couldn't send the reply. ${error.message}`,
        }),
      );
    },
  });
  const resolveMutate = resolve.mutate;
  const sendMutate = send.mutate;

  const actions = useMemo<ThreadCardActions>(() => {
    const edit = (patch: Partial<ThreadCardState>) => {
      change(key, patchCard(discussion, patch));
    };
    // The state now, not the render's: a second click before the re-render sends nothing.
    const current = (): ThreadCardState => {
      const s = useReviewStore.getState();
      return (s.key === key ? s.threadCards[discussion] : undefined) ?? NO_THREAD_CARD;
    };
    return {
      open: () => {
        edit({ composing: true, text: '', focus: true, error: null });
      },
      close: () => {
        edit({ composing: false, text: '', focus: false });
      },
      type: (text) => {
        edit({ text });
      },
      focused: () => {
        edit({ focus: false });
      },
      setResolved: (resolved, done) => {
        if (current().resolving) return;
        edit({ resolving: true, error: null });
        resolveMutate({ discussion, resolved }, { onSuccess: done });
      },
      reply: (body, done) => {
        if (current().sending) return;
        edit({ sending: true, error: null });
        sendMutate({ discussion, body }, { onSuccess: done });
      },
    };
  }, [change, discussion, key, resolveMutate, sendMutate]);

  return { ...state, ...actions };
}
