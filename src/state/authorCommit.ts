import { create } from 'zustand';
import type { CommitResult } from '../ipc/types/CommitResult';

/** Where **Push and reply** stands (F-26.5). */
export type AuthorPushPhase = 'idle' | 'pushing' | 'failed' | 'pullFirst' | 'done';

/** The commit panel of a fixed S-10 thread (F-26.4): what is typed, the switch, the result. */
export interface AuthorCommitDraft {
  message: string;
  /** "As a fixup of <sha> “<subject>”", on by default. */
  fixup: boolean;
  /** The commit made, once **Commit** succeeded. */
  committed: CommitResult | null;
  /** The reply to send after the push, "Fixed in <sha>. <one sentence>." (F-26.5), as edited. */
  reply: string;
  /** "Resolve the thread", on by default. */
  resolve: boolean;
  /** The queued reply's ID in the core, once **Commit** queued it. */
  replyId: string | null;
  push: AuthorPushPhase;
  /** When the push and the reply went through (ms since the epoch): S-10 polls the new pipeline. */
  pushedAt: number | null;
  /** Why the last push or reply failed (the Retry state). */
  pushError: string | null;
}

interface AuthorCommitStore {
  /** By thread ID: the panel outlives picking another thread and coming back (P-084). */
  drafts: Record<string, AuthorCommitDraft>;
  /**
   * A change of the thread's file was seen: opens the panel with `message`, or keeps the one
   * being written; a committed panel starts over for the next change.
   */
  open: (thread: string, message: string) => void;
  update: (thread: string, patch: Partial<AuthorCommitDraft>) => void;
  reset: () => void;
}

const FRESH_PUSH = {
  reply: '',
  resolve: true,
  replyId: null,
  push: 'idle',
  pushedAt: null,
  pushError: null,
} as const satisfies Partial<AuthorCommitDraft>;

export const useAuthorCommitStore = create<AuthorCommitStore>()((set) => ({
  drafts: {},
  open: (thread, message) => {
    set((s) => {
      const draft = s.drafts[thread];
      if (draft && draft.committed === null) return s;
      return {
        drafts: { ...s.drafts, [thread]: { message, fixup: true, committed: null, ...FRESH_PUSH } },
      };
    });
  },
  update: (thread, patch) => {
    set((s) => {
      const draft = s.drafts[thread];
      return draft ? { drafts: { ...s.drafts, [thread]: { ...draft, ...patch } } } : s;
    });
  },
  reset: () => {
    set({ drafts: {} });
  },
}));
