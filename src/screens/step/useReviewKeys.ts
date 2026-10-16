import { useEffect, useRef } from 'react';
import { isTyping } from '../../app/keyboard';
import { isShortcutKey, type ShortcutId } from '../../app/shortcuts';
import { useRiderKey } from '../../app/useRiderKey';
import type { IpcError } from '../../ipc/errors';
import { useRiderOpen } from '../../ipc/hooks/useChanges';
import { useDecide } from '../../ipc/hooks/useReview';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { FileStatus } from '../../ipc/types/FileStatus';
import type { Finding } from '../../ipc/types/Finding';
import type { Hunk } from '../../ipc/types/Hunk';
import type { LineSelection } from '../../ipc/types/LineSelection';
import type { Side } from '../../ipc/types/Side';
import { pathOf } from './diffPath';
import type { CurrentChange } from './useArrowWalk';

interface StepHunk {
  file: string;
  status: FileStatus;
  hunk: Hunk;
}

/** The step's hunks over its files in diff order; a file-level hunk has no lines to show. */
function stepHunks(files: readonly FileDiff[]): StepHunk[] {
  return files.flatMap((file) =>
    file.hunks
      .filter((h) => !h.fileLevel)
      .map((hunk) => ({ file: pathOf(file), status: file.status, hunk })),
  );
}

/**
 * The working-copy line Rider opens for a line of the diff: a new-side line is itself; an old-side
 * line (a removed one) is not in the working copy, so the first new line of its hunk.
 */
function workingLine(hunks: readonly StepHunk[], file: string, side: Side, line: number): number {
  if (side === 'new') return line;
  const inFile = hunks.filter((h) => h.file === file);
  const hunk =
    inFile.find((h) => line >= h.hunk.oldStart && line < h.hunk.oldStart + h.hunk.oldLines) ??
    inFile[0];
  return Math.max(1, hunk?.hunk.newStart ?? 1);
}

/**
 * The note D and X act on (M4 decision 14): the focused note when it is in the current change,
 * else the change's first open note, else its first; with no note in the change (or no current
 * change) the focused note.
 */
export function keyNote(
  files: readonly FileDiff[],
  findings: readonly Finding[],
  focused: Finding | undefined,
  current: { file: string; hunk: string } | null,
): Finding | undefined {
  const hunk = current
    ? stepHunks(files).find((h) => h.file === current.file && h.hunk.id === current.hunk)?.hunk
    : undefined;
  if (!current || !hunk) return focused;
  const inside = findings.filter((f) => {
    if (f.file !== current.file) return false;
    const [start, count] =
      f.side === 'new' ? [hunk.newStart, hunk.newLines] : [hunk.oldStart, hunk.oldLines];
    return f.line >= start && f.line < start + Math.max(1, count);
  });
  if (inside.length === 0) return focused;
  return (
    inside.find((f) => f.id === focused?.id) ??
    inside.find((f) => f.decision === 'open') ??
    inside[0]
  );
}

/**
 * Where `Ctrl+Shift+O` opens Rider (M4 decision 14): the selected lines, else the focused note,
 * else the current hunk, else the step's first hunk, each at its first line in the working copy.
 * Nothing for a deleted file, as its Open in Rider button is disabled (FileBar, DiffPane).
 */
export function riderTarget(
  files: readonly FileDiff[],
  selection: LineSelection | null,
  focused: Finding | undefined,
  current: { file: string; hunk: string } | null,
): { file: string; line: number } | null {
  const hunks = stepHunks(files);
  const at = selection
    ? { file: selection.file, side: selection.side, line: Math.min(selection.start, selection.end) }
    : focused
      ? { file: focused.file, side: focused.side, line: focused.line }
      : null;
  if (at) {
    if (files.find((f) => pathOf(f) === at.file)?.status === 'deleted') return null;
    return { file: at.file, line: workingLine(hunks, at.file, at.side, at.line) };
  }
  const hunk =
    (current && hunks.find((h) => h.file === current.file && h.hunk.id === current.hunk)) ??
    hunks[0];
  if (!hunk || hunk.status === 'deleted') return null;
  return { file: hunk.file, line: Math.max(1, hunk.hunk.newStart) };
}

export interface ReviewKeysOptions {
  sessionId: string;
  /** The step's files with only its hunks (`StepView.files`). */
  files: readonly FileDiff[];
  /** The step's notes in line order. */
  findings: readonly Finding[];
  focused: string | null;
  selection: LineSelection | null;
  /** The change the arrow keys made current (`useCurrentChange`). */
  current: CurrentChange | null;
  /** `N`: the next note in line order was picked (S-03; S-04's Guide aside has its own). */
  onNote?: (findingId: string) => void;
  /** `A`: Ask Claude (S-03; S-04's Guide aside has its own). */
  onAsk?: () => void;
}

/**
 * The letter keys of S-03 and S-04 (F-30.6, M4 decision 14), read from the shortcuts table: `N`
 * picks the next note and wraps, `D`/`X` add the note of the current change - else the focused
 * note - to drafts or dismiss it (a decided note stays as it is), `A` asks Claude, and
 * `Ctrl+Shift+O` opens Rider at the current line. The arrow keys are `useArrowWalk`'s. The letters
 * type in a text field and leave Ctrl, Alt (AltGr), Shift and Win combinations to others, but act
 * while a button has the focus; a held letter acts once. The `error` is a failed decision or
 * Rider open, for the screen to show.
 */
export function useReviewKeys({
  sessionId,
  files,
  findings,
  focused,
  selection,
  current,
  onNote,
  onAsk,
}: ReviewKeysOptions): { error: IpcError | null } {
  const decide = useDecide(sessionId);
  const rider = useRiderOpen();
  const note = findings.find((f) => f.id === focused);

  function send(kind: 'addToDrafts' | 'dismiss') {
    const target = keyNote(files, findings, note, current);
    if (target?.decision !== 'open' || decide.isPending) return;
    decide.mutate({ findingId: target.id, decision: { kind } });
  }

  const keys: [ShortcutId, (() => void) | undefined][] = [
    [
      'nextNote',
      onNote &&
        (() => {
          const next =
            findings[(findings.findIndex((f) => f.id === focused) + 1) % findings.length];
          if (next) onNote(next.id);
        }),
    ],
    [
      'addToDrafts',
      () => {
        send('addToDrafts');
      },
    ],
    [
      'dismissNote',
      () => {
        send('dismiss');
      },
    ],
    ['ask', onAsk],
  ];
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target)) return;
      const run = latest.current.find(([id]) => isShortcutKey(event, id))?.[1];
      if (!run) return;
      event.preventDefault();
      if (!event.repeat) run();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const target = riderTarget(files, selection, note, current);
  useRiderKey(
    target
      ? () => {
          rider.mutate({ file: target.file, line: target.line, session: sessionId });
        }
      : undefined,
  );

  return { error: decide.error ?? rider.error };
}
