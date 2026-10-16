import type { Draft } from '../../ipc/types/Draft';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { Fold } from '../../ipc/types/Fold';
import type { Line } from '../../ipc/types/Line';
import { pathOf } from './diffPath';
import type { LineSelection } from '../../ipc/types/LineSelection';
import { pickedSelection, type PickedLines } from './lineSelection';

/** The diff line a comment is on: one line of one side (`DiffPosition`). */
export interface LineAnchor {
  file: string;
  side: 'old' | 'new';
  line: number;
}

/**
 * The open line comment composer of the step (F-09.7, M4 decision 13); null = closed. Kept with
 * the step's state, so a layout or mode switch keeps it where it was.
 */
export interface LineComment extends LineAnchor {
  /** The text it opens with: empty, or the text Undo brought back. */
  text: string;
  /** The draft it made: the card shows it with the confirmation and Undo. */
  draft: { id: string; body: string } | null;
  /** The draft the card stands for (its own, or the one Undo deleted): not listed twice. */
  covers: string | null;
  /** Opening again remounts the card; S-04 also scrolls it into view by it. */
  nonce: number;
  /** C on the open composer's line moves the focus back to its text area. */
  focus: number;
}

let opened = 0;

/**
 * A number that grows with every request to bring a card into view, so the latest request wins
 * when a file has several (S-04: the callout of a picked note and the composer).
 */
export function nextNonce(): number {
  opened += 1;
  return opened;
}

/** "L50"; the old side says so: "old L38". */
export const anchorLabel = (at: LineAnchor): string =>
  `${at.side === 'old' ? 'old ' : ''}L${String(at.line)}`;

export const sameAnchor = (a: LineAnchor, b: LineAnchor): boolean =>
  a.file === b.file && a.side === b.side && a.line === b.line;

/** With several lines selected the comment goes under the last one (M4 decision 13). */
export const lastLine = (selection: LineSelection): LineAnchor => ({
  file: selection.file,
  side: selection.side,
  line: Math.max(selection.start, selection.end),
});

export const lastPicked = (picked: PickedLines): LineAnchor => lastLine(pickedSelection(picked));

/**
 * The step's first changed line the reader sees: outside mechanical hunks and Claude's folds (a
 * deleted line is where the next new-side line is, as the diff folds it). A run of deleted lines
 * followed by added ones shares its first split row: the added line is anchored, the new side
 * being the one a reader comments on; a run of deletions only anchors its first deleted line.
 */
export function firstChangedLine(
  files: readonly FileDiff[],
  folds: readonly Fold[],
): LineAnchor | null {
  for (const file of files) {
    const path = pathOf(file);
    const folded = (no: number) =>
      folds.some((f) => f.file === path && no >= f.newStart && no <= f.newEnd);
    for (const hunk of file.hunks) {
      if (hunk.fileLevel || hunk.mechanical) continue;
      const lines = hunk.lines;
      const end = hunk.newStart + Math.max(hunk.newLines - 1, 0);
      const position = (i: number): number =>
        lines.slice(i).find((l) => l.newNo !== undefined)?.newNo ?? end;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line || line.kind === 'ctx' || folded(position(i))) continue;
        const anchor = anchorOfRun(lines, i);
        if (anchor) return { file: path, ...anchor };
      }
    }
  }
  return null;
}

function anchorOfRun(lines: readonly Line[], start: number): Omit<LineAnchor, 'file'> | null {
  let i = start;
  while (lines[i]?.kind === 'del') i += 1;
  const added = lines[i];
  if (added?.kind === 'add' && added.newNo !== undefined) return { side: 'new', line: added.newNo };
  const first = lines[start];
  if (first?.kind === 'del' && first.oldNo !== undefined) return { side: 'old', line: first.oldNo };
  return null;
}

/** The step's line comments: drafts on a line with no note, in the order they were made. */
export function lineDraftsOf(
  drafts: readonly Draft[],
  stepId: string,
  except: string | null,
): (Draft & { position: NonNullable<Draft['position']> })[] {
  return drafts.flatMap((d) =>
    d.findingId === null && d.position !== null && d.stepId === stepId && d.id !== except
      ? [{ ...d, position: d.position }]
      : [],
  );
}
