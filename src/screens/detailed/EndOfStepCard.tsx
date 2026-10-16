import { useSearchParams } from 'react-router';
import { useFinishReview } from '../../app/titlebar/useFinishReview';
import { Button } from '../../components/Button';
import type { PlanView } from '../../ipc/types/PlanView';
import type { Step } from '../../ipc/types/Step';
import { stepSize } from './railText';
import styles from './EndOfStepCard.module.css';

export interface EndOfStepCardProps {
  /** The plan the screen shows: the reader's order and each step's numbers. */
  view: PlanView;
  /** The step on screen. */
  step: Step;
}

/**
 * The end-of-step card under the step's files (F-08.9, Main.dc.html): "End of step 4" in the
 * reader's order, "Next: <title> · N files · +add −del" with the rail's numbers and a yellow Next
 * step (F-08.4; no key hint, `↓` walks on through the changes, F-30.6). On the last step "That
 * was the last step." and Finish review in its place, which opens the summary, S-05 (M4 decision
 * 11); `↓` at the end of the last step moves the focus to it (M4 decision 15). The card is where
 * the walk pauses at the end of a step (`data-end-of-step`).
 */
export function EndOfStepCard({ view, step }: EndOfStepCardProps) {
  const [, setParams] = useSearchParams();
  const finishReview = useFinishReview();
  const order = view.order.order;
  const index = order.indexOf(step.id);
  const nextId = index >= 0 ? order[index + 1] : undefined;
  const at = nextId === undefined ? -1 : view.plan.steps.findIndex((s) => s.id === nextId);
  const next = view.plan.steps[at];
  const stats = view.stepStats[at];

  return (
    <div className={styles.card} data-end-of-step>
      <div className={styles.text}>
        <span className={styles.kicker}>{`End of step ${String(index + 1)}`}</span>
        {next ? (
          <span className={styles.line}>
            Next: <b className={styles.title}>{next.title}</b>
            {stats && (
              <>
                {' '}
                <span className={styles.meta}>{`· ${stepSize(stats)}`}</span>
              </>
            )}
          </span>
        ) : (
          <span className={styles.line}>That was the last step.</span>
        )}
      </div>
      {next ? (
        <Button
          variant="primary"
          size={40}
          onClick={() => {
            setParams({ step: next.id });
          }}
        >
          Next step
        </Button>
      ) : (
        <Button variant="primary" size={40} onClick={finishReview} data-finish-review>
          Finish review
        </Button>
      )}
    </div>
  );
}
