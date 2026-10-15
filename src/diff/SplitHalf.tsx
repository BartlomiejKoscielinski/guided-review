import { cx } from '../components/cx';
import type { ReactNode } from 'react';
import type { Line } from '../ipc/types/Line';
import type { DiffTokens } from './highlight';
import { LineNumber } from './LineNumber';
import { LineText } from './LineText';
import type { DiffStaging } from './staging';
import styles from './DiffView.module.css';

export interface SplitHalfProps {
  line: Line | undefined;
  side: 'old' | 'new';
  tokens: DiffTokens | null;
  dim: boolean;
  staging?: DiffStaging;
  /** Gutter markers of this side's line (F-07.5). */
  marker?: ReactNode;
  /** A gutter wide enough for markers. */
  wide?: boolean;
  /** The line is one of the selected lines (F-10.1). */
  selected?: boolean;
  /** A click on the number selects the line, Shift+click extends the selection (F-10.1). */
  onPick?: (no: number, extend: boolean) => void;
}

const SIGN = { add: '+', del: '−', ctx: '' } as const;

/** One side of a split row; an empty side when the other side has no counterpart. */
export function SplitHalf({
  line,
  side,
  tokens,
  dim,
  staging,
  marker,
  wide,
  selected = false,
  onPick,
}: SplitHalfProps) {
  if (!line) return <div className={cx(styles.half, styles.empty, wide && styles.wide)} />;
  const no = side === 'old' ? line.oldNo : line.newNo;
  const toggle = staging
    ? () => {
        staging.onLine(line, !line.staged);
      }
    : undefined;
  const pick =
    onPick && no !== undefined
      ? (extend: boolean) => {
          onPick(no, extend);
        }
      : undefined;
  return (
    <div
      className={cx(
        styles.half,
        styles[line.kind],
        dim && styles.dim,
        wide && styles.wide,
        selected && styles.selected,
      )}
      data-kind={line.kind}
      data-selected={selected ? 'true' : undefined}
    >
      <LineNumber no={no} line={line} onShiftClick={toggle} onPick={pick} marker={marker} />
      <span className={styles.sign} aria-hidden="true">
        {SIGN[line.kind]}
      </span>
      <LineText line={line} tokens={no === undefined ? undefined : tokens?.[side].get(no)} />
    </div>
  );
}
