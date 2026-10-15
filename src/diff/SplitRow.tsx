import type { ReactNode } from 'react';
import { cx } from '../components/cx';
import type { Line } from '../ipc/types/Line';
import type { DiffTokens } from './highlight';
import { SplitHalf } from './SplitHalf';
import type { DiffStaging } from './staging';
import styles from './DiffView.module.css';

type Side = 'old' | 'new';

export interface SplitRowProps {
  left: Line | undefined;
  right: Line | undefined;
  tokens: DiffTokens | null;
  /** Dims a side's line (unstaged in local mode). */
  isDim: (line: Line) => boolean;
  last: boolean;
  staging?: DiffStaging;
  /** Gutter markers of a side's line; `undefined` when the diff has none. */
  markerOf?: (side: Side, line: Line) => ReactNode;
  /** Whether a side's line is one of the selected lines (F-10.1). */
  isSelected?: (side: Side, line: Line) => boolean;
  /** A click on a side's line number (F-10.1). */
  onPick?: (side: Side, no: number, extend: boolean) => void;
}

/** One row of the split diff: old side left, new side right (F-15.5). */
export function SplitRow({
  left,
  right,
  tokens,
  isDim,
  last,
  staging,
  markerOf,
  isSelected,
  onPick,
}: SplitRowProps) {
  const pick = (side: Side) =>
    onPick
      ? (no: number, extend: boolean) => {
          onPick(side, no, extend);
        }
      : undefined;
  return (
    <div className={cx(styles.split, last && styles.last)}>
      <SplitHalf
        line={left}
        side="old"
        tokens={tokens}
        dim={left ? isDim(left) : false}
        staging={staging}
        marker={left && markerOf?.('old', left)}
        selected={left !== undefined && isSelected?.('old', left) === true}
        onPick={pick('old')}
      />
      <SplitHalf
        line={right}
        side="new"
        tokens={tokens}
        dim={right ? isDim(right) : false}
        staging={staging}
        marker={right && markerOf?.('new', right)}
        wide={markerOf !== undefined}
        selected={right !== undefined && isSelected?.('new', right) === true}
        onPick={pick('new')}
      />
    </div>
  );
}
