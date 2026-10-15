import { create } from 'zustand';

/** S-03 layouts (F-07.1): A Sidebar, B Minimal, C Guide. */
export type FocusLayout = 'A' | 'B' | 'C';

export interface FocusState {
  layout: FocusLayout;
  setLayout: (layout: FocusLayout) => void;
}

/**
 * S-03 state that outlives a layout: which layout is shown. The step is in the URL, the focused
 * note and the answer live in the step body, which stays mounted when the layout changes, so all
 * three layouts share one state (F-07.1).
 */
export const useFocusStore = create<FocusState>()((set) => ({
  layout: 'A',
  setLayout: (layout) => {
    set({ layout });
  },
}));

/** `Ctrl+1/2/3` without Alt or Shift (so AltGr chords on Polish keyboards don't trigger it). */
export function layoutShortcut(event: KeyboardEvent): FocusLayout | null {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return null;
  if (event.key === '1') return 'A';
  if (event.key === '2') return 'B';
  if (event.key === '3') return 'C';
  return null;
}
