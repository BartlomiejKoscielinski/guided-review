import { create } from 'zustand';
import type { PrepareProgress } from '../ipc/types/PrepareProgress';

/** S-01 state that outlives the screen: Ctrl+K focus requests and MR preparation progress. */
export interface StartState {
  /** Ctrl+K was pressed; the S-01 input takes focus once it is on screen (F-01.4). */
  focusPending: boolean;
  /** The preparation started from S-01 (F-05.6): its task name and the latest stage. */
  preparing: { task: string; progress: PrepareProgress | null } | null;
  requestFocus: () => void;
  focusTaken: () => void;
  setPreparing: (preparing: StartState['preparing']) => void;
}

export const useStartStore = create<StartState>()((set) => ({
  focusPending: false,
  preparing: null,
  requestFocus: () => {
    set({ focusPending: true });
  },
  focusTaken: () => {
    set({ focusPending: false });
  },
  setPreparing: (preparing) => {
    set({ preparing });
  },
}));
