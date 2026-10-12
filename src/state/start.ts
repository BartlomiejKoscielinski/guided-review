import { create } from 'zustand';
import type { PrepareProgress } from '../ipc/types/PrepareProgress';
import type { Route } from '../ipc/types/Route';

/** How a preparation ended while S-02 Preparing shows it (F-05.6). */
export type PrepareOutcome = { kind: 'opened'; route: Route } | { kind: 'failed'; message: string };

/** An MR preparation started from S-01 (F-05.6), shown by S-02 Preparing. */
export interface Preparation {
  /** The task name for `sessionPrepareCancel`. */
  task: string;
  iid: number;
  /** From the first stage ("Fetching !482"): GitLab knows the MR. */
  title: string | null;
  /** The latest stage; null until GitLab answered. */
  progress: PrepareProgress | null;
  outcome: PrepareOutcome | null;
}

/** S-01 state that outlives the screen: Ctrl+K focus requests and MR preparation progress. */
export interface StartState {
  /** Ctrl+K was pressed; the S-01 input takes focus once it is on screen (F-01.4). */
  focusPending: boolean;
  preparing: Preparation | null;
  requestFocus: () => void;
  focusTaken: () => void;
  prepareStarted: (task: string, iid: number) => void;
  prepareProgress: (task: string, progress: PrepareProgress) => void;
  prepareFinished: (task: string, outcome: PrepareOutcome) => void;
  /** Forgets the preparation `task`; one that was replaced by a newer one stays. */
  prepareCleared: (task: string) => void;
}

export const useStartStore = create<StartState>()((set) => {
  /** Applies `change` to the preparation `task` only, so a late event can't touch a newer one. */
  const update = (task: string, change: (p: Preparation) => Preparation | null) => {
    set((state) =>
      state.preparing?.task === task ? { preparing: change(state.preparing) } : state,
    );
  };
  return {
    focusPending: false,
    preparing: null,
    requestFocus: () => {
      set({ focusPending: true });
    },
    focusTaken: () => {
      set({ focusPending: false });
    },
    prepareStarted: (task, iid) => {
      set({ preparing: { task, iid, title: null, progress: null, outcome: null } });
    },
    prepareProgress: (task, progress) => {
      update(task, (p) => ({
        ...p,
        progress,
        title: progress.stage === 'fetching' ? progress.title : p.title,
      }));
    },
    prepareFinished: (task, outcome) => {
      update(task, (p) => ({ ...p, outcome }));
    },
    prepareCleared: (task) => {
      update(task, () => null);
    },
  };
});
