import type { ReactNode } from 'react';
import type { Line } from '../ipc/types/Line';
import { cx } from '../components/cx';
import type { DiffTokens } from './highlight';
import { LineNumber } from './LineNumber';
import { LineText } from './LineText';
import type { DiffStaging } from './staging';
import styles from './DiffView.module.css';

export interface UnifiedRowProps {
  line: Line;
  tokens: DiffTokens | null;
  /** Local mode: unstaged changes are dimmed (the hunk dims as a whole when nothing is in). */
  dim: boolean;
  last: boolean;
  staging?: DiffStaging;
  /** Gutter markers of the line (F-07.5). */
  marker?: ReactNode;
}

const SIGN = { add: '+', del: '−', ctx: '' } as const;

/** One line of the unified diff: old and new numbers, sign, code. */
export function UnifiedRow({ line, tokens, dim, last, staging, marker }: UnifiedRowProps) {
  const side = line.kind === 'del' ? tokens?.old : tokens?.new;
  const no = line.kind === 'del' ? line.oldNo : line.newNo;
  const toggle = staging
    ? () => {
        staging.onLine(line, !line.staged);
      }
    : undefined;
  return (
    <div
      className={cx(styles.unified, styles[line.kind], dim && styles.dim, last && styles.last)}
      data-kind={line.kind}
      data-staged={line.staged === undefined ? undefined : String(line.staged)}
    >
      <LineNumber no={line.oldNo} line={line} onShiftClick={toggle} />
      <LineNumber no={line.newNo} line={line} onShiftClick={toggle} marker={marker} />
      <span className={styles.sign} aria-hidden="true">
        {SIGN[line.kind]}
      </span>
      <LineText line={line} tokens={no === undefined ? undefined : side?.get(no)} />
    </div>
  );
}
