import { create } from 'zustand';
import type { FixCardState } from '../screens/fix/fixState';

/** The one fix open at a time (M7 decision 4): its note, its run and what its card shows. */
export interface OpenFix {
  /** The note it belongs to (`fixKey`). */
  key: string;
  /** The run's task ID for `claudeCancel`. */
  task: string;
  state: FixCardState;
}

interface FixStore {
  /** Kept here so the card outlives a layout switch and leaving the screen (P-084). */
  open: OpenFix | null;
  setOpen: (open: OpenFix | null) => void;
  /** Applies a run's outcome, unless the run was cancelled or replaced meanwhile. */
  settle: (task: string, state: FixCardState) => void;
  reset: () => void;
}

export const useFixStore = create<FixStore>()((set) => ({
  open: null,
  setOpen: (open) => {
    set({ open });
  },
  settle: (task, state) => {
    set((s) => (s.open?.task === task ? { open: { ...s.open, state } } : s));
  },
  reset: () => {
    set({ open: null });
  },
}));

/** The store key of a note: a Claude note (S-03) or a kept note (S-05) of a session. */
export function fixKey(sessionId: string, note: { findingId: string } | { draftId: string }) {
  return 'findingId' in note
    ? `${sessionId}\0finding\0${note.findingId}`
    : `${sessionId}\0draft\0${note.draftId}`;
}

/** The store key of a thread of my MR on S-10 (F-25.1). */
export function threadFixKey(project: string, iid: number, threadId: string) {
  return `author\0${project}\0${String(iid)}\0${threadId}`;
}
