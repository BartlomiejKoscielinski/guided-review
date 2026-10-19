import { cx } from '../../components/cx';
import type { JobState } from '../../ipc/types/JobState';
import styles from './StageColumns.module.css';

/** Each state's icon (Pipeline.dc.html): size, path, stroke width (filled when null). */
const ICON: Record<JobState, { size: number; d: string; stroke: number | null } | null> = {
  passed: { size: 11, d: 'M3 8.5l3.2 3L13 4.5', stroke: 3 },
  failed: { size: 10, d: 'M3.5 3.5l9 9M12.5 3.5l-9 9', stroke: 3 },
  failedAllowed: { size: 10, d: 'M8 2.5v7M8 12.5v1', stroke: 3 },
  running: { size: 12, d: 'M8 2a6 6 0 1 1-6 6', stroke: 2.6 },
  waiting: null,
  manual: { size: 9, d: 'M4 2.5v11l9.5-5.5z', stroke: null },
  canceled: { size: 10, d: 'M3.5 3.5l9 9M12.5 3.5l-9 9', stroke: 3 },
  skipped: { size: 10, d: 'M3 13 13 3', stroke: 3 },
};

/** A job's status square with its icon (F-20.2); the state in words is on the row's button. */
export function JobSquare({ state }: { state: JobState }) {
  const icon = ICON[state];
  return (
    <span
      data-testid="job-square"
      data-state={state}
      className={cx(styles.sq, styles[`sq-${state}`])}
    >
      {icon && (
        <svg
          width={icon.size}
          height={icon.size}
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={state === 'running' ? styles.spin : undefined}
          fill={icon.stroke === null ? 'currentColor' : 'none'}
          stroke={icon.stroke === null ? undefined : 'currentColor'}
          strokeWidth={icon.stroke ?? undefined}
          strokeLinecap={icon.stroke === null ? undefined : 'square'}
        >
          <path d={icon.d} />
        </svg>
      )}
    </span>
  );
}
