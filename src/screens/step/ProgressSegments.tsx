import { cx } from '../../components/cx';
import styles from './Progress.module.css';

export interface ProgressSegmentsProps {
  /** The ids of the plan's steps in the reader's order: one segment each. */
  order: readonly string[];
  /** The step being read: its segment is yellow. */
  current: string;
  /** The steps marked reviewed (`PlanView.reviewed`): their segments are green. */
  reviewed: readonly string[];
  /**
   * "bar" = 18x6 in the title bar (layout B), "guide" = 10x10 in the guide panel (layout C),
   * "info" = 12x6 in the S-04 info header (F-08.2).
   */
  size: 'bar' | 'guide' | 'info';
}

/**
 * One segment per step (F-07.1): green when the step is marked reviewed, yellow on the current
 * step (even when it is reviewed), dark otherwise. Being past a step does not make it done.
 */
export function ProgressSegments({ order, current, reviewed, size }: ProgressSegmentsProps) {
  return (
    <>
      {order.map((id) => (
        <span
          key={id}
          className={cx(
            styles.segment,
            styles[size],
            id === current ? styles.now : reviewed.includes(id) && styles.done,
          )}
        />
      ))}
    </>
  );
}
