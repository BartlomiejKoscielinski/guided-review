import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { DiffView } from '../../diff/DiffView';
import { lineKey } from '../../diff/rows';
import { ignoreWhitespace } from '../../diff/whitespace';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { Finding } from '../../ipc/types/Finding';
import { useDetailedStore } from '../../state/detailed';
import { pathOf } from '../step/diffPath';
import { NoteMark } from '../step/GutterMarks';
import type { LineCard } from '../step/useLineComments';
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
  /**
   * Set (a new number each time) when the Guide aside picked the focused note: its callout is
   * brought into view (F-08.7).
   */
  reveal?: number;
  /** The hunk J/K made current, when it is in this file (F-30.6). */
  current?: { hunk: string; nonce: number };
  /** The step's line comments and the open composer (F-09.7), in any file. */
  comments?: readonly LineCard[];
  /** The file is marked reviewed in the step (F-07.10). */
  reviewed?: boolean;
  /** The file bar's Reviewed toggle (F-07.10). */
  onReviewed?: () => void;
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
  reveal,
  current,
  comments = [],
  reviewed,
  onReviewed,
}: DetailedFileProps) {
  const path = pathOf(file);
  const layout = useDetailedStore((s) => s.layout);
  const setLayout = useDetailedStore((s) => s.setLayout);
  const ignore = useDetailedStore((s) => s.ignoreWhitespace);
  const setIgnore = useDetailedStore((s) => s.setIgnoreWhitespace);
  const diff = useMemo(() => (ignore ? ignoreWhitespace(file) : file), [file, ignore]);
  // A hunk J/K scrolls to the top sits under the sticky file bar, its header in view (F-30.6).
  const sectionRef = useRef<HTMLElement>(null);
  const barHeight = useFirstChildHeight(sectionRef);

  // The callout scrolls into view once per request, not again when the virtual list remounts it.
  const revealed = useRef<number | undefined>(undefined);
  const showCallout = (el: HTMLDivElement | null) => {
    if (el === null || reveal === undefined || revealed.current === reveal) return;
    revealed.current = reveal;
    el.scrollIntoView({ block: 'nearest' });
  };
  let focusedAt: string | undefined;

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
      focusedAt = key;
      inserts.set(key, [
        ...(inserts.get(key) ?? []),
        <div key={finding.id} ref={showCallout} className={styles.row}>
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

  // The composer opened last, or the note picked last, is brought into view: both numbers grow
  // with every request (`nextNonce`).
  let latest =
    reveal !== undefined && focusedAt !== undefined ? { at: focusedAt, nonce: reveal } : undefined;
  // A line comment opens the mechanical hunk's fold it is in (F-09.7).
  const unfold = new Set<string>();
  for (const card of comments) {
    if (card.file !== path) continue;
    const at = lineKey(card.side, card.line);
    unfold.add(at);
    inserts.set(at, [
      ...(inserts.get(at) ?? []),
      <div key={card.id} className={styles.row}>
        {card.node}
      </div>,
    ]);
    if (card.reveal !== undefined && card.reveal > (latest?.nonce ?? 0)) {
      latest = { at, nonce: card.reveal };
    }
  }

  return (
    <section ref={sectionRef} aria-label={path}>
      <FileBar
        sessionId={sessionId}
        file={file}
        path={path}
        layout={layout}
        onLayout={setLayout}
        ignoreWhitespace={ignore}
        onIgnoreWhitespace={setIgnore}
        reviewed={reviewed}
        onReviewed={onReviewed}
      />
      <DiffView
        path={path}
        diff={diff}
        layout={layout}
        scrollRoot={scrollRoot}
        markers={markers}
        inserts={inserts.size > 0 ? inserts : undefined}
        unfold={unfold}
        reveal={latest}
        current={current}
        stickyTop={barHeight}
        empty={file.binary ? 'Binary file. Not shown.' : undefined}
      />
    </section>
  );
}

/** The height of the element's first child (S-04's sticky file bar), kept as it changes. */
function useFirstChildHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const bar = ref.current?.firstElementChild;
    if (!(bar instanceof HTMLElement)) return;
    const update = () => {
      setHeight(bar.offsetHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return height;
}
