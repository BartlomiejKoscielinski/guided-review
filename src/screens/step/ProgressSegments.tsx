import { cx } from '../../components/cx';
import styles from './Progress.module.css';

export interface ProgressSegmentsProps {
  /** Number of steps in the reader's order. */
  total: number;
  /** 1-based position of the current step. */
  current: number;
  /** "bar" = 18x6 in the title bar (layout B), "guide" = 10x10 in the guide panel (layout C). */
  size: 'bar' | 'guide';
}

/**
 * One segment per step: green before the current step, yellow on it, dark after it (F-07.1).
 * TODO(F-07.1): done = reviewed once `review_mark_step` is wired (3f follow-up).
 */
export function ProgressSegments({ total, current, size }: ProgressSegmentsProps) {
  return (
    <>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cx(
            styles.segment,
            styles[size],
            i + 1 < current && styles.done,
            i + 1 === current && styles.now,
          )}
        />
      ))}
    </>
  );
}
