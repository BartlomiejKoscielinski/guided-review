import { create } from 'zustand';
import type { TaskPhase } from '../ipc/hooks/useReview';
import type { AskState } from '../screens/step/askState';
import type { LineComment } from '../screens/step/lineComment';
import type { PickedLines } from '../screens/step/lineSelection';

/** Claude's answer in an open answer card (F-10): kept here so it outlives the card. */
export interface AskThread {
  /** The card it belongs to (`AskState.nonce`). */
  nonce: number;
  /** The question asked last; null before one was asked. */
  question: string | null;
  text: string;
  phase: TaskPhase;
  /** A question is on its way (the ask command hasn't settled yet). */
  asking: boolean;
  error: string | null;
  /** The answer went to the drafts (F-10.3). */
  added: boolean;
}

/** What the reader did on the step that is open: the step body's state (F-07.1, F-08.1). */
export interface StepReview {
  /** The note the reader focused; null: the step's first open note of the highest severity. */
  focus: string | null;
  /** The selected lines (F-10.1). */
  picked: PickedLines | null;
  /** The open answer card. */
  ask: AskState | null;
  thread: AskThread | null;
  /** The open line comment composer (F-09.7). */
  comment: LineComment | null;
}

export const NO_REVIEW: StepReview = {
  focus: null,
  picked: null,
  ask: null,
  thread: null,
  comment: null,
};

type Patch = (state: StepReview) => Partial<StepReview>;

interface ReviewStore extends StepReview {
  /** The session and step the state belongs to (`reviewKey`). */
  key: string | null;
  /** The step was opened: another step's state is dropped, the same step's is kept. */
  claim: (key: string) => void;
  /** A change by the reader on the step `key`, which claims it. */
  change: (key: string, patch: Patch) => void;
  /** A change from a running task: dropped when the reader opened another step meanwhile. */
  follow: (key: string, patch: Patch) => void;
  reset: () => void;
}

export const reviewKey = (sessionId: string, stepId: string): string =>
  JSON.stringify([sessionId, stepId]);

/**
 * The state of the step the reader is on, outside the screen that shows it, so a switch between
 * Focus (S-03) and Detailed (S-04) keeps the focused note, the selected lines and Claude's answer
 * (F-08.1, ADR-010), like a layout switch does. Keyed by session and step: opening another step
 * starts it fresh, as S-03 always did.
 */
export const useReviewStore = create<ReviewStore>()((set) => ({
  key: null,
  ...NO_REVIEW,
  claim: (key) => {
    set((s) => (s.key === key ? {} : { key, ...NO_REVIEW }));
  },
  change: (key, patch) => {
    set((s) => (s.key === key ? patch(s) : { key, ...NO_REVIEW, ...patch(NO_REVIEW) }));
  },
  follow: (key, patch) => {
    set((s) => (s.key === key ? patch(s) : {}));
  },
  reset: () => {
    set({ key: null, ...NO_REVIEW });
  },
}));

/** One field of the step's state; the empty value while another step holds the store. */
export function useStepReview<K extends keyof StepReview>(key: string, field: K): StepReview[K] {
  return useReviewStore((s) => (s.key === key ? s[field] : NO_REVIEW[field]));
}
