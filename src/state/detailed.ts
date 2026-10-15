import { create } from 'zustand';
import type { DiffLayout } from '../diff/rows';

export interface DetailedState {
  /** Split | Unified on every S-04 file bar. */
  layout: DiffLayout;
  /** Ignore whitespace on every S-04 file bar, display only. */
  ignoreWhitespace: boolean;
  setLayout: (layout: DiffLayout) => void;
  setIgnoreWhitespace: (on: boolean) => void;
}

/**
 * S-04 diff options (F-08.5, M4 decision 5): one value for the whole Detailed view, shown on every
 * file bar and kept for the app run (not saved); default Split with whitespace shown. Focus mode
 * stays split and doesn't read it (F-07.4).
 */
export const useDetailedStore = create<DetailedState>()((set) => ({
  layout: 'split',
  ignoreWhitespace: false,
  setLayout: (layout) => {
    set({ layout });
  },
  setIgnoreWhitespace: (on) => {
    set({ ignoreWhitespace: on });
  },
}));
