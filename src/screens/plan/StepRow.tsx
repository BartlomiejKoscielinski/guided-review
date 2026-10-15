import { useSortable } from '@dnd-kit/sortable';
import type { CSSProperties } from 'react';
import type { ChangeStats } from '../../ipc/types/ChangeStats';
import type { Step } from '../../ipc/types/Step';
import { filesLabel, LAYER_LABEL } from './planText';
import styles from './PlanList.module.css';

/** Width of the add/delete bar (Overview.dc.html: 120px, at least 3px per part). */
const BAR = 120;

export interface StepRowProps {
  step: Step;
  position: number;
  stats: ChangeStats;
  /** The largest added or deleted count among the rows: the bars' scale. */
  scale: number;
  /** The fallback plan's rows don't move. */
  sortable: boolean;
}

const barWidth = (n: number, scale: number) =>
  n > 0 ? Math.max(3, Math.round((n / Math.max(scale, 1)) * BAR)) : 0;

function GripIcon() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
      <rect x="2" y="1.5" width="3" height="3" />
      <rect x="7" y="1.5" width="3" height="3" />
      <rect x="2" y="5.5" width="3" height="3" />
      <rect x="7" y="5.5" width="3" height="3" />
      <rect x="2" y="9.5" width="3" height="3" />
      <rect x="7" y="9.5" width="3" height="3" />
    </svg>
  );
}

/**
 * A plan row (F-06.3): drag handle, number, title, layer tag, reason, `N files · +add −del` and
 * the add/delete bar. The handle drags with the mouse or the keyboard (F-06.5).
 */
export function StepRow({ step, position, stats, scale, sortable }: StepRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id, disabled: !sortable });
  const style: CSSProperties = {
    transform: transform ? `translate3d(0, ${String(Math.round(transform.y))}px, 0)` : undefined,
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={styles.row}
      data-dragging={isDragging || undefined}
      data-step={step.id}
    >
      {sortable ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={styles.handle}
          {...attributes}
          {...listeners}
          aria-label={`Move step: ${step.title}`}
          aria-describedby={attributes['aria-describedby']}
        >
          <GripIcon />
        </button>
      ) : (
        <span />
      )}
      <span className={styles.number}>{position}</span>
      <span className={styles.body}>
        <span className={styles.titleLine}>
          <span className={styles.stepTitle}>{step.title}</span>
          <span className={styles.layer}>{LAYER_LABEL[step.layer]}</span>
        </span>
        <span className={styles.reason}>{step.reason}</span>
      </span>
      <span className={styles.stats}>
        <span className={styles.counts}>
          {filesLabel(stats)} · <span className={styles.add}>+{stats.additions}</span>{' '}
          {stats.deletions > 0 && <span className={styles.del}>−{stats.deletions}</span>}
        </span>
        <span className={styles.bar} aria-hidden="true">
          <span className={styles.barAdd} style={{ width: barWidth(stats.additions, scale) }} />
          <span className={styles.barDel} style={{ width: barWidth(stats.deletions, scale) }} />
        </span>
      </span>
    </li>
  );
}
