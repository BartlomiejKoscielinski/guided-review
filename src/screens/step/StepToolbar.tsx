import { Button } from '../../components/Button';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../../components/icons';
import type { StepView } from '../../ipc/types/StepView';
import styles from './Guide.module.css';

export interface StepToolbarProps {
  view: StepView;
  onGo: (stepId: string) => void;
  onAsk: () => void;
}

/**
 * Layout B's floating toolbar (F-07.8): previous, "Step 4 of 8", next, Mark reviewed and Ask
 * Claude, centered at the bottom.
 */
export function StepToolbar({ view, onGo, onAsk }: StepToolbarProps) {
  const { prev, next } = view;
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
        disabled={next === undefined}
        onClick={() => {
          if (next !== undefined) onGo(next);
        }}
      >
        <ChevronRightIcon size={16} strokeWidth={2.2} />
      </button>
      <span className={styles.divider} aria-hidden="true" />
      {/* Wired with `review_mark_step` (sidebar checks, Space). */}
      <Button variant="primary" size={38} aria-pressed={view.reviewed} disabled>
        <CheckIcon size={14} strokeWidth={2.6} />
        {view.reviewed ? 'Reviewed' : 'Mark reviewed'}
      </Button>
      <Button variant="claude" size={38} onClick={onAsk}>
        Ask Claude
      </Button>
    </div>
  );
}
