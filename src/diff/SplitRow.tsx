import { cx } from '../components/cx';
import type { Line } from '../ipc/types/Line';
import type { DiffTokens } from './highlight';
import { SplitHalf } from './SplitHalf';
import type { DiffStaging } from './staging';
import styles from './DiffView.module.css';

export interface SplitRowProps {
  left: Line | undefined;
  right: Line | undefined;
  tokens: DiffTokens | null;
  /** Dims a side's line (unstaged in local mode). */
  isDim: (line: Line) => boolean;
  last: boolean;
  staging?: DiffStaging;
}

/** One row of the split diff: old side left, new side right (F-15.5). */
export function SplitRow({ left, right, tokens, isDim, last, staging }: SplitRowProps) {
  return (
    <div className={cx(styles.split, last && styles.last)}>
      <SplitHalf
        line={left}
        side="old"
        tokens={tokens}
        dim={left ? isDim(left) : false}
        staging={staging}
      />
      <SplitHalf
        line={right}
        side="new"
        tokens={tokens}
        dim={right ? isDim(right) : false}
        staging={staging}
      />
    </div>
  );
}
