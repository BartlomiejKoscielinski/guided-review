import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { cx } from '../components/cx';
import { alignTop, pageThrough, registerPager, rowBox, type Box } from './currentChange';
import type { FileDiff } from '../ipc/types/FileDiff';
import type { Hunk } from '../ipc/types/Hunk';
import type { Line } from '../ipc/types/Line';
import { useHighlight } from './highlight';
import { FoldRow } from './FoldRow';
import { HunkHeader } from './HunkHeader';
import { buildRows, lineKey, type DiffFold, type DiffLayout, type DiffRow } from './rows';
import { SplitRow } from './SplitRow';
import { hunkState, type DiffStaging } from './staging';
import { UnifiedRow } from './UnifiedRow';
import styles from './DiffView.module.css';

export interface DiffViewProps {
  /** Repository-relative path (language detection, cache key). */
  path: string;
  diff: FileDiff;
  layout: DiffLayout;
  /** Local mode: checkboxes write to the index. */
  staging?: DiffStaging;
  /** Text under the last hunk ("Shift + click line numbers to pick single lines."). */
  note?: ReactNode;
  /** Shown instead of hunks (binary file, nothing to show). */
  empty?: ReactNode;
  /** Hunk header bars; S-03 shows none. */
  headers?: boolean;
  /** Regions folded until **Show** besides mechanical hunks (F-07.4). */
  folds?: readonly DiffFold[];
  /** Gutter markers by `lineKey` (F-07.5); a diff with markers gets a wider new-side gutter. */
  markers?: ReadonlyMap<string, ReactNode>;
  /** Rows under a line by `lineKey`: note and thread cards (F-07.6). */
  inserts?: ReadonlyMap<string, ReactNode>;
  /** Line keys (`lineKey`) whose fold opens on its own: line comments (F-09.7). */
  unfold?: ReadonlySet<string>;
  /** Selected lines of one side, highlighted (F-10.1; split layout). */
  selection?: { side: 'old' | 'new'; start: number; end: number } | null;
  /** A click on a line number: select it, Shift+click extends (F-10.1; split layout). */
  onPickLine?: (side: 'old' | 'new', no: number, extend: boolean) => void;
  /** Scroll with this element instead of an own scroller (S-03's main column). */
  scrollRoot?: RefObject<HTMLElement | null>;
  /** The +/− column; S-03 has none (Review.dc.html: 48px and 60px gutters, number then code). */
  signs?: boolean;
  /**
   * Scrolls to the insert row under the line `at` once per request: each time `nonce` grows past
   * the last one handled, so the row renders even when it is outside the virtual window (S-04's
   * callout of a note picked in the Guide aside, F-08.7). An older request shown again (N's note
   * once the composer opened after it is closed) does not scroll back to it (F-30.6).
   */
  reveal?: { at: string; nonce: number };
  /**
   * The change (hunk `id`) the arrow keys made current (F-30.6, M4 decisions 14 and 15): its first
   * row - the hunk header where headers show, a closed fold's row - carries the focus outline and
   * `aria-current`; each time `nonce` changes it scrolls to the top of the screen (`scroll`
   * "change", the default), or its file's header does ("file"). The walk pages through it.
   */
  current?: DiffCurrent;
  /** Height of a sticky bar over the diff in `scrollRoot` (S-04's file bar): a hunk scrolled to the top sits under it. */
  stickyTop?: number;
}

/** The current change of the walk in this diff (F-30.6). */
export interface DiffCurrent {
  /** The hunk's `id`; empty for a file without rows to show (its header is the stop). */
  hunk: string;
  nonce: number;
  /** What scrolls to the top when `nonce` changes: the change (default), its file, or nothing. */
  scroll?: 'change' | 'file' | 'none';
}

const LINE = 22;

function estimate(row: DiffRow | undefined): number {
  if (!row) return LINE;
  if (row.kind === 'hunk') return row.first ? 31 : 45;
  if (row.kind === 'note') return 40;
  if (row.kind === 'fold') return 40;
  if (row.kind === 'insert') return 160;
  return LINE;
}

/**
 * Virtualized diff (ADR-007, F-15.5): unified or split, line numbers, hunk headers, syntax
 * colors from the Shiki worker and intraline emphasis. Long lines wrap, so rows are measured.
 */
export function DiffView({
  path,
  diff,
  layout,
  staging,
  note,
  empty,
  headers = true,
  folds,
  markers,
  inserts,
  unfold,
  selection,
  onPickLine,
  scrollRoot,
  signs = true,
  reveal,
  current,
  stickyTop = 0,
}: DiffViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tokens = useHighlight(path, diff);
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const insertKeys = [...(inserts?.keys() ?? [])].join(' ');
  const unfoldKeys = [...(unfold ?? [])].join(' ');
  const rows = useMemo(
    () =>
      buildRows(diff, layout, {
        note: note !== undefined,
        headers,
        folds,
        shown,
        inserts: new Set(insertKeys.split(' ')),
        unfold: new Set(unfoldKeys.split(' ')),
      }),
    [diff, layout, note, headers, folds, shown, insertKeys, unfoldKeys],
  );
  const margin = useScrollMargin(scrollRoot, listRef);
  // TanStack Virtual returns fresh functions each render; this component isn't memoized.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => (scrollRoot ? scrollRoot.current : scrollRef.current),
    scrollMargin: margin,
    estimateSize: (i) => estimate(rows[i]),
    overscan: 24,
    getItemKey: (i) => rows[i]?.key ?? i,
    scrollPaddingStart: stickyTop,
  });

  const revealAt = reveal?.at;
  const revealNonce = reveal?.nonce;
  const revealed = useRef(-Infinity);
  useEffect(() => {
    if (revealAt === undefined || revealNonce === undefined || revealNonce <= revealed.current)
      return;
    revealed.current = revealNonce;
    const index = rows.findIndex((row) => row.kind === 'insert' && row.at === revealAt);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    // Once per request: the rows and the virtualizer change with every scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealAt, revealNonce]);

  const currentHunk = current?.hunk;
  const currentNonce = current?.nonce;
  const currentScroll = current?.scroll ?? 'change';
  const hunkRows = (hunk: string | undefined): [number, number] | null => {
    if (!hunk) return null;
    const first = rows.findIndex((row) => row.key.startsWith(`${hunk}#`));
    if (first < 0) return null;
    return [first, rows.findLastIndex((row) => row.key.startsWith(`${hunk}#`))];
  };
  const currentIndex = hunkRows(currentHunk)?.[0] ?? -1;
  const rootOf = () => (scrollRoot ? scrollRoot.current : scrollRef.current);
  const boxOf = (index: number): Box | null => {
    const list = listRef.current;
    return list
      ? rowBox(list, virtualizer.measurementsCache, index, virtualizer.options.scrollMargin)
      : null;
  };
  /** The current change on screen, from its first row to its last (notes under it included). */
  const changeBox = (): Box | null => {
    const range = hunkRows(currentHunk);
    const first = range && boxOf(range[0]);
    const last = range && boxOf(range[1]);
    return first && last ? { top: first.top, bottom: last.bottom } : null;
  };
  /** The current change, or its file's header, to the top of the screen. */
  const alignCurrent = () => {
    const root = rootOf();
    if (!root) return;
    const box = currentScroll === 'change' && currentIndex >= 0 ? boxOf(currentIndex) : null;
    if (box) {
      alignTop(root, stickyTop, box.top);
      return;
    }
    const file = (listRef.current ?? wrapRef.current ?? scrollRef.current)?.closest('section');
    if (file) alignTop(root, 0, file.getBoundingClientRect().top);
  };
  const latest = useRef({ alignCurrent, changeBox, rootOf, stickyTop });
  useEffect(() => {
    latest.current = { alignCurrent, changeBox, rootOf, stickyTop };
  });
  useEffect(() => {
    if (currentHunk === undefined || currentScroll === 'none') return undefined;
    latest.current.alignCurrent();
    // Rows the virtualizer only estimated are drawn and measured over the next frames: once they
    // are, the change lands exactly (S-04 under its sticky file bar).
    let frames = 0;
    let frame = requestAnimationFrame(function again() {
      latest.current.alignCurrent();
      frames += 1;
      if (frames < 3) frame = requestAnimationFrame(again);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
    // Once per move of the walk, as `reveal`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHunk, currentNonce]);
  useEffect(() => {
    if (!currentHunk) return undefined;
    return registerPager(path, currentHunk, (direction) => {
      const { changeBox: box, rootOf: root, stickyTop: sticky } = latest.current;
      const change = box();
      const element = root();
      return change !== null && element !== null && pageThrough(element, sticky, change, direction);
    });
  }, [path, currentHunk]);

  const hunkDim = useMemo(() => {
    const map = new Map<Hunk, boolean>();
    for (const hunk of diff.hunks)
      map.set(hunk, staging !== undefined && hunkState(hunk) === 'off');
    return map;
  }, [diff, staging]);
  const isDim = (hunk: Hunk) => (line: Line) =>
    staging !== undefined && (hunkDim.get(hunk) === true || line.staged === false);

  const fileLabel =
    diff.status === 'added' ? 'new file' : diff.status === 'deleted' ? 'deleted file' : undefined;

  const markerOf = (side: 'old' | 'new', line: Line): ReactNode => {
    const no = side === 'new' ? line.newNo : line.kind === 'del' ? line.oldNo : undefined;
    return no === undefined ? undefined : markers?.get(lineKey(side, no));
  };

  const isSelected = (side: 'old' | 'new', line: Line): boolean => {
    if (selection?.side !== side) return false;
    const no = side === 'new' ? line.newNo : line.oldNo;
    const low = Math.min(selection.start, selection.end);
    const high = Math.max(selection.start, selection.end);
    return no !== undefined && no >= low && no <= high;
  };

  const render = (row: DiffRow): ReactNode => {
    switch (row.kind) {
      case 'hunk':
        return (
          <HunkHeader
            hunk={row.hunk}
            first={row.first}
            fileLabel={diff.hunks.length === 1 ? fileLabel : undefined}
            staging={staging}
          />
        );
      case 'line':
        return (
          <UnifiedRow
            markerOf={markers ? markerOf : undefined}
            line={row.line}
            tokens={tokens}
            dim={isDim(row.hunk)(row.line)}
            last={row.last}
            staging={staging}
          />
        );
      case 'pair':
        return (
          <SplitRow
            left={row.left}
            right={row.right}
            tokens={tokens}
            isDim={isDim(row.hunk)}
            last={row.last}
            staging={staging}
            markerOf={markers ? markerOf : undefined}
            isSelected={selection ? isSelected : undefined}
            onPick={onPickLine}
          />
        );
      case 'fold':
        return (
          <FoldRow
            label={row.label}
            onShow={() => {
              setShown((old) => new Set(old).add(row.key));
            }}
          />
        );
      case 'insert':
        return <div className={styles.insert}>{inserts?.get(row.at)}</div>;
      case 'note':
        return <p className={styles.note}>{note}</p>;
    }
  };

  const list =
    rows.length === 0 && empty ? (
      <div className={styles.emptyState}>{empty}</div>
    ) : (
      <div ref={listRef} className={styles.sizer} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className={cx(styles.row, item.index === currentIndex && styles.current)}
              aria-current={item.index === currentIndex ? 'true' : undefined}
              style={{ transform: `translateY(${String(item.start - margin)}px)` }}
            >
              {render(row)}
            </div>
          );
        })}
      </div>
    );

  if (scrollRoot) {
    return (
      <div ref={wrapRef} className={cx(styles.inline, !signs && styles.noSigns)}>
        {list}
      </div>
    );
  }
  return (
    <div
      ref={scrollRef}
      className={cx(styles.scroller, !signs && styles.noSigns)}
      data-testid="diff-scroller"
    >
      {list}
    </div>
  );
}

/**
 * Where the list starts inside an outer scroller, kept up to date as the content above it
 * changes height (notes state, earlier files). A column mounted together with its diff (S-04
 * opened by Ctrl+D with the step already read) attaches its ref after the diff's layout effects,
 * so the margin is measured again once the column is there.
 */
function useScrollMargin(
  root: RefObject<HTMLElement | null> | undefined,
  list: RefObject<HTMLDivElement | null>,
): number {
  const [margin, setMargin] = useState(0);
  const [attached, setAttached] = useState(false);
  const missed = useRef(false);
  useLayoutEffect(() => {
    const outer = root?.current;
    missed.current = root !== undefined && !outer;
    if (!outer) return;
    const update = () => {
      const el = list.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top - outer.getBoundingClientRect().top;
      setMargin(Math.max(0, Math.round(top + outer.scrollTop)));
    };
    update();
    const observer = new ResizeObserver(update);
    for (const child of Array.from(outer.children)) observer.observe(child);
    return () => {
      observer.disconnect();
    };
  }, [root, list, attached]);
  useEffect(() => {
    if (missed.current && root?.current) setAttached(true);
  }, [root]);
  return margin;
}
