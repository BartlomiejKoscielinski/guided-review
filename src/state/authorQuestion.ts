import { create } from 'zustand';

/** Where the reply composer of an S-10 question stands (F-26.7). */
export type QuestionReplyPhase = 'idle' | 'drafting' | 'sending' | 'sent';

/** The reply composer of one question thread: what is typed, the run in flight, the last error. */
export interface QuestionReply {
  text: string;
  phase: QuestionReplyPhase;
  /** Why the last draft or send failed; cleared by the next one. */
  error: string | null;
}

interface AuthorQuestionStore {
  /** By thread ID: the composer outlives picking another thread and coming back. */
  replies: Record<string, QuestionReply>;
  update: (thread: string, patch: Partial<QuestionReply>) => void;
  reset: () => void;
}

export const EMPTY_REPLY: QuestionReply = { text: '', phase: 'idle', error: null };

export const useAuthorQuestionStore = create<AuthorQuestionStore>()((set) => ({
  replies: {},
  update: (thread, patch) => {
    set((s) => ({
      replies: { ...s.replies, [thread]: { ...(s.replies[thread] ?? EMPTY_REPLY), ...patch } },
    }));
  },
  reset: () => {
    set({ replies: {} });
  },
}));
