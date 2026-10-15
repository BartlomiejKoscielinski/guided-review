import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { reviewKey, useReviewStore, useStepReview, type AskThread } from '../../state/review';
import { toIpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { LineSelection } from '../types/LineSelection';
import { CLAUDE_STATUS_KEY } from './useClaude';

const newThread = (nonce: number): AskThread => ({
  nonce,
  question: null,
  text: '',
  phase: 'idle',
  asking: false,
  error: null,
  added: false,
});

export interface Ask {
  /** The card's thread; null before the card was opened (`open`). */
  thread: AskThread | null;
  /** The card is there: later mounts of it (a layout or mode switch) show its thread again. */
  open: () => void;
  ask: (question: string, selection: LineSelection | null) => void;
  /** The answer went to the drafts (F-10.3). */
  added: () => void;
}

/**
 * Questions on a step in the answer card `nonce` (F-10.1, F-10.2): `text` grows with each
 * streamed piece and is replaced by the whole answer at the end; asking again on the step is a
 * follow-up. The thread is kept with the step's state (`state/review.ts`), so the card shows it
 * again after a layout or mode switch (F-08.1) and a stream still running writes on.
 */
export function useAsk(sessionId: string, stepId: string, nonce: number): Ask {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const key = reviewKey(sessionId, stepId);
  const stored = useStepReview(key, 'thread');
  const change = useReviewStore((s) => s.change);
  const follow = useReviewStore((s) => s.follow);
  const actions = useMemo(() => {
    // This card's thread only; dropped once the reader opened another step or card.
    const write = (patch: (thread: AskThread) => Partial<AskThread>) => {
      follow(key, (s) =>
        s.thread?.nonce === nonce ? { thread: { ...s.thread, ...patch(s.thread) } } : {},
      );
    };
    return {
      open: () => {
        change(key, (s) => (s.thread?.nonce === nonce ? {} : { thread: newThread(nonce) }));
      },
      ask: (question: string, selection: LineSelection | null) => {
        change(key, (s) => ({
          thread: {
            ...(s.thread?.nonce === nonce ? s.thread : newThread(nonce)),
            question,
            text: '',
            asking: true,
            error: null,
            added: false,
          },
        }));
        ipc
          .reviewAsk(sessionId, stepId, question, selection, (event) => {
            write((t) => {
              if (event.kind === 'partialText')
                return { phase: event.kind, text: t.text + event.text };
              if (event.kind === 'done') return { phase: event.kind, text: event.result.text };
              return { phase: event.kind };
            });
          })
          .then(
            () => {
              write(() => ({ asking: false }));
            },
            (error: unknown) => {
              write(() => ({ asking: false, phase: 'failed', error: toIpcError(error).message }));
            },
          )
          .finally(() => {
            void queryClient.invalidateQueries({ queryKey: CLAUDE_STATUS_KEY });
          });
      },
      added: () => {
        write(() => ({ added: true }));
      },
    };
  }, [change, follow, ipc, key, nonce, queryClient, sessionId, stepId]);
  return { thread: stored?.nonce === nonce ? stored : null, ...actions };
}
