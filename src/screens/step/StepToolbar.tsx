import { useFinishReview } from '../../app/titlebar/useFinishReview';
import { Button } from '../../components/Button';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../../components/icons';
import type { StepView } from '../../ipc/types/StepView';
import styles from './Guide.module.css';

export interface StepToolbarProps {
  view: StepView;
  onGo: (stepId: string) => void;
  /** Mark reviewed or its undo (F-07.2). */
  onToggleReviewed: () => void;
  onAsk: () => void;
}

/**
 * Layout B's floating toolbar (F-07.8): previous, "Step 4 of 8", next, Mark reviewed and Ask
 * Claude, centered at the bottom. On the last step next opens S-05 (F-30.3, M4 decision 11).
 */
export function StepToolbar({ view, onGo, onToggleReviewed, onAsk }: StepToolbarProps) {
  const { prev, next } = view;
  const finishReview = useFinishReview();
  return (
    <div role="toolbar" aria-label="Step navigation" className={styles.toolbar}>
      <button
        type="button"
        className={styles.arrow}
        aria-label="Previous step"
        disabled={prev === undefined}
        onClick={() => {
          if (prev !== undefined) onGo(prev);
        }}
      >
        <ChevronLeftIcon size={16} strokeWidth={2.2} />
      </button>
      <span className={styles.position}>
        Step <span className={styles.positionNow}>{view.number}</span> of {view.total}
      </span>
      <button
        type="button"
        className={styles.arrow}
        aria-label="Next step"
        onClick={() => {
          if (next !== undefined) onGo(next);
          else finishReview();
        }}
      >
        <ChevronRightIcon size={16} strokeWidth={2.2} />
      </button>
      <span className={styles.divider} aria-hidden="true" />
      <Button
        variant="primary"
        size={38}
        className={styles.reviewed}
        aria-pressed={view.reviewed}
        onClick={onToggleReviewed}
      >
        <CheckIcon size={14} strokeWidth={2.6} />
        {view.reviewed ? 'Reviewed' : 'Mark reviewed'}
      </Button>
      <Button variant="claude" size={38} onClick={onAsk}>
        Ask Claude
      </Button>
    </div>
  );
}
