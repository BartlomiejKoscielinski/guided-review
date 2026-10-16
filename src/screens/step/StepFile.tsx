import { useMemo, type ReactNode, type RefObject } from 'react';
import { DiffView, type DiffCurrent } from '../../diff/DiffView';
import { lineKey, type DiffFold } from '../../diff/rows';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { Finding } from '../../ipc/types/Finding';
import type { Fold } from '../../ipc/types/Fold';
import type { LineSelection } from '../../ipc/types/LineSelection';
import type { Thread } from '../../ipc/types/Thread';
import { pathOf } from './diffPath';
import { FileReviewed } from './FileReviewed';
import { FileThreads } from './FileThreads';
import { NoteMark } from './GutterMarks';
import type { LineCard } from './useLineComments';
import { useThreadRows } from './useThreadRows';
import { NoteCard } from './NoteCard';
import styles from './Step.module.css';

export interface StepFileProps {
  sessionId: string;
  /** The step shown: its thread cards keep their state with the step's (F-11.2). */
  stepId: string;
  file: FileDiff;
  /** The step's notes in this file, with their number in the step. */
  findings: { finding: Finding; number: number }[];
  folds: Fold[];
  threads: Thread[];
  /** The step's threads on this file's header (F-11.3). */
  fileThreads?: readonly Thread[];
  focus: string | null;
  onFocus: (findingId: string) => void;
  scrollRoot: RefObject<HTMLElement | null>;
  selfReview?: boolean;
  onAsk?: (finding: Finding) => void;
  /** Layout C: numbered gutter squares, and the focused note opens in the guide panel. */
  guide?: boolean;
  /**
   * The answer card (F-10) under the selected lines, in layouts A and B; a new `reveal` (A while it
   * is open, F-30.6) brings it into view.
   */
  answer?: { side: 'old' | 'new'; line: number; node: ReactNode; file: string; reveal?: number };
  /** The step's selected lines (F-10.1) with their "Selected lines" group, in any file. */
  selected?: { selection: LineSelection; bar: ReactNode } | null;
  /** A click on a line number of this file (F-10.1). */
  onPickLine?: (at: { file: string; side: 'old' | 'new'; no: number }, extend: boolean) => void;
  /** The step's line comments and the open composer (F-09.7), in any file. */
  comments?: readonly LineCard[];
  /** The change the arrow keys made current, when it is in this file (F-30.6). */
  current?: DiffCurrent;
  /** Brings the focused note's card into view once per value, a `nextNonce` (N, F-30.6). */
  revealFocus?: number;
  /** The file is marked reviewed in the step (F-07.10). */
  reviewed?: boolean;
  /** The header's Reviewed toggle (F-07.10); without it the header has none. */
  onReviewed?: () => void;
}

/**
 * One file of a step (F-07.3–F-07.6): path, `+add −del`, "N notes" and the Reviewed toggle
 * (F-07.10), the threads on the file header (F-11.3), then the split diff with fold rows, gutter
 * squares and thread icons, the focused note and open threads under their lines.
 */
export function StepFile({
  sessionId,
  stepId,
  file,
  findings,
  folds,
  threads,
  fileThreads = [],
  focus,
  onFocus,
  scrollRoot,
  selfReview,
  onAsk,
  guide = false,
  answer,
  selected,
  onPickLine,
  comments = [],
  current,
  revealFocus,
  reviewed = false,
  onReviewed,
}: StepFileProps) {
  const path = pathOf(file);
  const selection = selected?.selection.file === path ? selected.selection : null;
  const scope = { sessionId, stepId };
  const threadRows = useThreadRows(threads, scope);
  const open = findings.filter(({ finding }) => finding.decision === 'open').length;

  const diffFolds = useMemo<DiffFold[]>(
    () =>
      folds.map((f) => ({
        newStart: f.newStart,
        newEnd: f.newEnd,
        label: `${f.title}: ${f.reason}`,
      })),
    [folds],
  );

  const markers = new Map<string, ReactNode[]>();
  const inserts = new Map<string, ReactNode[]>();
  const push = (map: Map<string, ReactNode[]>, key: string, node: ReactNode) => {
    map.set(key, [...(map.get(key) ?? []), node]);
  };
  // The "Selected lines" group sits right under the last selected line (F-10.1).
  if (selected && selection) {
    push(
      inserts,
      lineKey(selection.side, Math.max(selection.start, selection.end)),
      <div key="selection">{selected.bar}</div>,
    );
  }
  for (const { finding, number } of findings) {
    const key = lineKey(finding.side, finding.line);
    const focused = finding.id === focus;
    push(
      markers,
      key,
      <NoteMark
        key={finding.id}
        finding={finding}
        number={number}
        focused={focused}
        numbered={guide}
        onFocus={() => {
          onFocus(finding.id);
        }}
      />,
    );
    if (focused && !guide) {
      push(
        inserts,
        key,
        <div key={finding.id} className={styles.inlineCard}>
          <NoteCard finding={finding} sessionId={sessionId} selfReview={selfReview} onAsk={onAsk} />
        </div>,
      );
    }
  }
  if (answer && answer.file === path) {
    push(
      inserts,
      lineKey(answer.side, answer.line),
      <div key="answer" className={styles.inlineCard}>
        {answer.node}
      </div>,
    );
  }
  // A line comment opens the fold it is in, so the reader finds it where they wrote it (F-09.7).
  const unfold = new Set<string>();
  let reveal: { at: string; nonce: number } | undefined;
  const focusedHere = guide ? undefined : findings.find(({ finding }) => finding.id === focus);
  if (focusedHere && revealFocus !== undefined) {
    reveal = {
      at: lineKey(focusedHere.finding.side, focusedHere.finding.line),
      nonce: revealFocus,
    };
  }
  if (
    answer?.file === path &&
    answer.reveal !== undefined &&
    answer.reveal > (reveal?.nonce ?? 0)
  ) {
    reveal = { at: lineKey(answer.side, answer.line), nonce: answer.reveal };
  }
  for (const card of comments) {
    if (card.file !== path) continue;
    const at = lineKey(card.side, card.line);
    unfold.add(at);
    push(
      inserts,
      at,
      <div key={card.id} className={styles.inlineCard}>
        {card.node}
      </div>,
    );
    // The latest request wins: a comment opened after N, or N after the comment.
    if (card.reveal !== undefined && card.reveal > (reveal?.nonce ?? 0)) {
      reveal = { at, nonce: card.reveal };
    }
  }
  // A thread's line is never folded: the fold is cut around it and 3 lines on each side, so the
  // thread shows on its line with the lines around it and the rest of the fold still closed
  // (F-11.3, an outdated thread placed inside a fold).
  const keep = new Set<string>();
  for (const row of threadRows) {
    push(markers, row.key, row.mark);
    if (row.card) push(inserts, row.key, row.card);
    keep.add(row.key);
  }

  return (
    <section className={styles.file} aria-label={path}>
      <div className={styles.fileHead}>
        <span className={styles.fileName}>
          <span className={styles.path}>{path}</span>
          <span className={styles.stats}>
            <span className={styles.add}>+{file.additions}</span>{' '}
            <span className={styles.del}>−{file.deletions}</span>
          </span>
        </span>
        <span className={styles.fileTools}>
          {findings.length > 0 && (
            <span className={styles.noteCount}>
              <span className={styles.noteSquare} aria-hidden="true" />
              {open === 1 ? '1 note' : `${String(open)} notes`}
            </span>
          )}
          {onReviewed && <FileReviewed path={path} reviewed={reviewed} onToggle={onReviewed} />}
        </span>
      </div>
      <FileThreads threads={fileThreads} path={path} scope={scope} />
      <DiffView
        path={path}
        diff={file}
        layout="split"
        headers={false}
        signs={false}
        folds={diffFolds}
        markers={markers}
        inserts={inserts}
        unfold={unfold}
        keep={keep}
        selection={selection}
        onPickLine={
          onPickLine
            ? (side, no, extend) => {
                onPickLine({ file: path, side, no }, extend);
              }
            : undefined
        }
        scrollRoot={scrollRoot}
        reveal={reveal}
        current={current}
        empty={file.binary ? 'Binary file. Not shown.' : undefined}
      />
    </section>
  );
}
