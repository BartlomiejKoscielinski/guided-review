import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, type ReactNode } from 'react';
import type { FileDiff } from '../ipc/types/FileDiff';
import type { Hunk } from '../ipc/types/Hunk';
import type { Line } from '../ipc/types/Line';
import { useHighlight } from './highlight';
import { HunkHeader } from './HunkHeader';
import { buildRows, type DiffLayout, type DiffRow } from './rows';
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
}

const LINE = 22;

function estimate(row: DiffRow | undefined): number {
  if (!row) return LINE;
  if (row.kind === 'hunk') return row.first ? 31 : 45;
  if (row.kind === 'note') return 40;
  return LINE;
}

/**
 * Virtualized diff (ADR-007, F-15.5): unified or split, line numbers, hunk headers, syntax
 * colors from the Shiki worker and intraline emphasis. Long lines wrap, so rows are measured.
 */
export function DiffView({ path, diff, layout, staging, note, empty }: DiffViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tokens = useHighlight(path, diff);
  const rows = useMemo(() => buildRows(diff, layout, note !== undefined), [diff, layout, note]);
  // TanStack Virtual returns fresh functions each render; this component isn't memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimate(rows[i]),
    overscan: 24,
    getItemKey: (i) => rows[i]?.key ?? i,
  });

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
          />
        );
      case 'note':
        return <p className={styles.note}>{note}</p>;
    }
  };

  return (
    <div ref={scrollRef} className={styles.scroller} data-testid="diff-scroller">
      {rows.length === 0 && empty ? (
        <div className={styles.emptyState}>{empty}</div>
      ) : (
        <div className={styles.sizer} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={styles.row}
                style={{ transform: `translateY(${String(item.start)}px)` }}
              >
                {render(row)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
