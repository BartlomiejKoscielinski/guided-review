import { create } from 'zustand';

/** Where the arrow-key walk opens a step it moved to (F-30.6, M4 decision 15). */
export interface WalkEntry {
  sessionId: string;
  stepId: string;
  /** `↓` past the end of a step opens the next one at its first change, `↑` the previous at its last. */
  at: 'first' | 'last';
}

/**
 * The step the walk is opening, kept across the step change: S-03 mounts a new step body, S-04
 * loads the step's files, and the walk makes the change current once they are there.
 */
export interface WalkState {
  entry: WalkEntry | null;
  enter: (entry: WalkEntry) => void;
  /** The entry for this step, which is then forgotten; null when the step was opened otherwise. */
  take: (sessionId: string, stepId: string) => WalkEntry['at'] | null;
}

export const useWalkStore = create<WalkState>()((set, get) => ({
  entry: null,
  enter: (entry) => {
    set({ entry });
  },
  take: (sessionId, stepId) => {
    const { entry } = get();
    if (entry?.sessionId !== sessionId || entry.stepId !== stepId) return null;
    set({ entry: null });
    return entry.at;
  },
}));
