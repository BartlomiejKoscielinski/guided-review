import { create } from 'zustand';
import { isShortcutChord, type ShortcutId } from '../app/shortcuts';

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

/** The layout shortcuts of the table (`Ctrl+1/2/3`, F-30.6; F-19.7 edits it). */
const LAYOUT_SHORTCUTS: readonly [ShortcutId, FocusLayout][] = [
  ['sidebarLayout', 'A'],
  ['minimalLayout', 'B'],
  ['guideLayout', 'C'],
];

/**
 * The layout of a pressed layout shortcut (`Ctrl+1/2/3` in the shortcuts table), with exactly its
 * modifiers (so AltGr chords on Polish keyboards don't trigger it).
 */
export function layoutShortcut(event: KeyboardEvent): FocusLayout | null {
  return LAYOUT_SHORTCUTS.find(([id]) => isShortcutChord(event, id))?.[1] ?? null;
}
