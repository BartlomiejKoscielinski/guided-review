import { useEffect, useRef, useState } from 'react';
import { isTyping } from '../../app/keyboard';
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
import { nextNonce } from './lineComment';

/** The hunk J/K made current, in its file; a new `nonce` scrolls it to the top again. */
export interface CurrentHunk {
  file: string;
  hunk: string;
  nonce: number;
}

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
  stepId: string;
  /** The step's files with only its hunks (`StepView.files`). */
  files: readonly FileDiff[];
  /** The step's notes in line order. */
  findings: readonly Finding[];
  focused: string | null;
  selection: LineSelection | null;
  /** `N`: the next note in line order was picked (S-03; S-04's Guide aside has its own). */
  onNote?: (findingId: string) => void;
  /** `A`: Ask Claude (S-03; S-04's Guide aside has its own). */
  onAsk?: () => void;
}

/**
 * The review keys of S-03 and S-04 (F-30.6, M4 decision 14): `J`/`K` move the current hunk over
 * the step's files in diff order and stop at the ends, `N` picks the next note and wraps, `D`/`X`
 * add the focused note to drafts or dismiss it (a decided note stays as it is), `A` asks Claude,
 * `Ctrl+Shift+O` opens Rider at the current line. The letters type in a text field and leave
 * Ctrl, Alt (AltGr), Shift and Win combinations to others, but act while a button has the focus.
 * The `error` is a failed decision or Rider open, for the screen to show.
 */
export function useReviewKeys({
  sessionId,
  stepId,
  files,
  findings,
  focused,
  selection,
  onNote,
  onAsk,
}: ReviewKeysOptions): { current: CurrentHunk | null; error: IpcError | null } {
  const [moved, setMoved] = useState<(CurrentHunk & { stepId: string }) | null>(null);
  const current = moved?.stepId === stepId ? moved : null;
  const decide = useDecide(sessionId);
  const rider = useRiderOpen();
  const hunks = stepHunks(files);
  const note = findings.find((f) => f.id === focused);
  const at = current
    ? hunks.findIndex((h) => h.file === current.file && h.hunk.id === current.hunk)
    : -1;

  function move(to: number) {
    const target = hunks[Math.min(hunks.length - 1, Math.max(0, to))];
    if (target) setMoved({ stepId, file: target.file, hunk: target.hunk.id, nonce: nextNonce() });
  }
  function send(kind: 'addToDrafts' | 'dismiss') {
    if (note?.decision !== 'open' || decide.isPending) return;
    decide.mutate({ findingId: note.id, decision: { kind } });
  }

  const keys: Record<string, (() => void) | undefined> = {
    j: () => {
      move(at < 0 ? 0 : at + 1);
    },
    k: () => {
      move(at < 0 ? 0 : at - 1);
    },
    n:
      onNote &&
      (() => {
        const next = findings[(findings.findIndex((f) => f.id === focused) + 1) % findings.length];
        if (next) onNote(next.id);
      }),
    d: () => {
      send('addToDrafts');
    },
    x: () => {
      send('dismiss');
    },
    a: onAsk,
  };
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.metaKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      const run = latest.current[key];
      if (!run) return;
      event.preventDefault();
      // Holding J or K walks the hunks; a held D, X or A acts once.
      if (event.repeat && key !== 'j' && key !== 'k') return;
      run();
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

  return { current, error: decide.error ?? rider.error };
}
