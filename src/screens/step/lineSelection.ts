import type { LineSelection } from '../../ipc/types/LineSelection';

/**
 * The lines picked with the diff's line numbers (F-10.1): the line clicked first (`anchor`) and
 * the line Shift+click extended to (`to`), on one side of one file.
 */
export interface PickedLines {
  file: string;
  side: 'old' | 'new';
  anchor: number;
  to: number;
}

/** A click on a line number; Shift+click extends on the same side of the same file only. */
export function pickLine(
  old: PickedLines | null,
  at: { file: string; side: 'old' | 'new'; no: number },
  extend: boolean,
): PickedLines {
  if (extend && old?.file === at.file && old.side === at.side) return { ...old, to: at.no };
  return { file: at.file, side: at.side, anchor: at.no, to: at.no };
}

/** The selection a question is about: lowest line first, as the core reads it. */
export const pickedSelection = (picked: PickedLines): LineSelection => ({
  file: picked.file,
  side: picked.side,
  start: Math.min(picked.anchor, picked.to),
  end: Math.max(picked.anchor, picked.to),
});

/** "Line 47", "Lines 47–50"; the old side says so: "Lines 37–38 (old)". */
export function selectionLabel(selection: LineSelection): string {
  const low = Math.min(selection.start, selection.end);
  const high = Math.max(selection.start, selection.end);
  const lines = low === high ? `Line ${String(low)}` : `Lines ${String(low)}–${String(high)}`;
  return selection.side === 'old' ? `${lines} (old)` : lines;
}
