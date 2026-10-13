import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import { DiffView } from '../../diff/DiffView';
import { lineKey, type DiffFold } from '../../diff/rows';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { Finding } from '../../ipc/types/Finding';
import type { Fold } from '../../ipc/types/Fold';
import type { Thread } from '../../ipc/types/Thread';
import { pathOf } from './diffPath';
import { NoteMark, ThreadMark } from './GutterMarks';
import { NoteCard } from './NoteCard';
import { ThreadCard } from './ThreadCard';
import styles from './Step.module.css';

export interface StepFileProps {
  sessionId: string;
  file: FileDiff;
  /** The step's notes in this file, with their number in the step. */
  findings: { finding: Finding; number: number }[];
  folds: Fold[];
  threads: Thread[];
  focus: string | null;
  onFocus: (findingId: string) => void;
  scrollRoot: RefObject<HTMLElement | null>;
  selfReview?: boolean;
  onAsk?: (finding: Finding) => void;
}

/** Where a thread sits in the diff: its new-side line, else its old-side line. */
function threadAt(thread: Thread): { key: string; line: number } | null {
  const pos = thread.position;
  if (pos?.newLine !== undefined) return { key: lineKey('new', pos.newLine), line: pos.newLine };
  if (pos?.oldLine !== undefined) return { key: lineKey('old', pos.oldLine), line: pos.oldLine };
  return null;
}

/**
 * One file of a step (F-07.3–F-07.6): path, `+add −del`, "N notes", then the split diff with fold
 * rows, gutter squares and thread icons, the focused note and open threads under their lines.
 */
export function StepFile({
  sessionId,
  file,
  findings,
  folds,
  threads,
  focus,
  onFocus,
  scrollRoot,
  selfReview,
  onAsk,
}: StepFileProps) {
  const path = pathOf(file);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
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
        onFocus={() => {
          onFocus(finding.id);
        }}
      />,
    );
    if (focused) {
      push(
        inserts,
        key,
        <div key={finding.id} className={styles.inlineCard}>
          <NoteCard finding={finding} sessionId={sessionId} selfReview={selfReview} onAsk={onAsk} />
        </div>,
      );
    }
  }
  for (const thread of threads) {
    const at = threadAt(thread);
    if (!at) continue;
    const isOpen = !closed.has(thread.id);
    push(
      markers,
      at.key,
      <ThreadMark
        key={thread.id}
        thread={thread}
        line={at.line}
        open={isOpen}
        onToggle={() => {
          setClosed((old) => {
            const next = new Set(old);
            if (isOpen) next.add(thread.id);
            else next.delete(thread.id);
            return next;
          });
        }}
      />,
    );
    if (isOpen)
      push(inserts, at.key, <ThreadCard key={thread.id} thread={thread} line={at.line} />);
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
        {findings.length > 0 && (
          <span className={styles.noteCount}>
            <span className={styles.noteSquare} aria-hidden="true" />
            {open === 1 ? '1 note' : `${String(open)} notes`}
          </span>
        )}
      </div>
      <DiffView
        path={path}
        diff={file}
        layout="split"
        headers={false}
        signs={false}
        folds={diffFolds}
        markers={markers}
        inserts={inserts}
        scrollRoot={scrollRoot}
        empty={file.binary ? 'Binary file. Not shown.' : undefined}
      />
    </section>
  );
}
