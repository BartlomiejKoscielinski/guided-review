import { useLocation } from 'react-router';
import { nextNonce } from './lineComment';

/** A thread whose card the step screen brings into view (S-05's Show in code, M5 decision 13). */
export interface ThreadReveal {
  /** GitLab's discussion id. */
  thread: string;
  /** From `nextNonce`, so a card opened or a note picked later wins (latest request). */
  nonce: number;
}

/** The location state Show in code opens S-03 or S-04 with. */
export interface ThreadRevealState {
  revealThread: ThreadReveal;
}

/** The state that asks the step screen to bring `thread`'s card into view, once. */
export const revealThreadState = (thread: string): ThreadRevealState => ({
  revealThread: { thread, nonce: nextNonce() },
});

const isReveal = (value: unknown): value is ThreadReveal =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<ThreadReveal>).thread === 'string' &&
  typeof (value as Partial<ThreadReveal>).nonce === 'number';

/** The thread the screen was opened to show (Show in code on S-05), else null. */
export function useThreadReveal(): ThreadReveal | null {
  const state: unknown = useLocation().state;
  if (typeof state !== 'object' || state === null) return null;
  const reveal = (state as Partial<ThreadRevealState>).revealThread;
  return isReveal(reveal) ? reveal : null;
}
