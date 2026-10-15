import { useMemo, type ReactNode, type RefObject } from 'react';
import { DiffView } from '../../diff/DiffView';
import { lineKey } from '../../diff/rows';
import { ignoreWhitespace } from '../../diff/whitespace';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { Finding } from '../../ipc/types/Finding';
import { useDetailedStore } from '../../state/detailed';
import { pathOf } from '../step/diffPath';
import { NoteMark } from '../step/GutterMarks';
import { FileBar } from './FileBar';
import { NoteCallout } from './NoteCallout';
import styles from './NoteCallout.module.css';

export interface DetailedFileProps {
  sessionId: string;
  file: FileDiff;
  /** S-04's main column, which scrolls the step and its files. */
  scrollRoot: RefObject<HTMLElement | null>;
  /** The step's notes in this file, with their number in the step. */
  findings?: { finding: Finding; number: number }[];
  /** The step's focused note: its callout opens under its line (F-08.6). */
  focus?: string | null;
  onFocus?: (findingId: string) => void;
  /** Self-review copy on the callout; undefined while the session is looked up. */
  selfReview?: boolean;
  onAsk?: (finding: Finding) => void;
}

/**
 * One file of the S-04 step (F-08.5): its sticky file bar, then the diff in the view's layout,
 * with whitespace-only changes shown as unchanged lines when Ignore whitespace is on. Each note
 * is a numbered mark on its line; the focused note's full callout sits under it (F-08.6).
 */
export function DetailedFile({
  sessionId,
  file,
  scrollRoot,
  findings = [],
  focus = null,
  onFocus,
  selfReview,
  onAsk,
}: DetailedFileProps) {
  const path = pathOf(file);
  const layout = useDetailedStore((s) => s.layout);
  const setLayout = useDetailedStore((s) => s.setLayout);
  const ignore = useDetailedStore((s) => s.ignoreWhitespace);
  const setIgnore = useDetailedStore((s) => s.setIgnoreWhitespace);
  const diff = useMemo(() => (ignore ? ignoreWhitespace(file) : file), [file, ignore]);

  const markers = new Map<string, ReactNode[]>();
  const inserts = new Map<string, ReactNode[]>();
  for (const { finding, number } of findings) {
    const key = lineKey(finding.side, finding.line);
    const focused = finding.id === focus;
    markers.set(key, [
      ...(markers.get(key) ?? []),
      <NoteMark
        key={finding.id}
        finding={finding}
        number={number}
        focused={focused}
        numbered
        onFocus={() => {
          onFocus?.(finding.id);
        }}
      />,
    ]);
    if (focused) {
      inserts.set(key, [
        ...(inserts.get(key) ?? []),
        <div key={finding.id} className={styles.row}>
          <NoteCallout
            finding={finding}
            sessionId={sessionId}
            number={number}
            selfReview={selfReview}
            onAsk={onAsk}
          />
        </div>,
      ]);
    }
  }

  return (
    <section aria-label={path}>
      <FileBar
        sessionId={sessionId}
        file={file}
        path={path}
        layout={layout}
        onLayout={setLayout}
        ignoreWhitespace={ignore}
        onIgnoreWhitespace={setIgnore}
      />
      <DiffView
        path={path}
        diff={diff}
        layout={layout}
        scrollRoot={scrollRoot}
        markers={markers}
        inserts={inserts.size > 0 ? inserts : undefined}
        empty={file.binary ? 'Binary file. Not shown.' : undefined}
      />
    </section>
  );
}
