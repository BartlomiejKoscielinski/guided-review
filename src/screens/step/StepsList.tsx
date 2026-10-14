import { cx } from '../../components/cx';
import { CheckIcon, SkimIcon } from '../../components/icons';
import type { Step } from '../../ipc/types/Step';
import styles from './Step.module.css';

export interface StepsListProps {
  /** The plan's steps in the reader's order. */
  steps: Step[];
  current: string;
  /** The steps marked reviewed (`PlanView.reviewed`): a check instead of the number. */
  reviewed: readonly string[];
  /** Files in the skim groups: "Skim · N files". */
  skimFiles: number;
  onSelect: (stepId: string) => void;
}

/**
 * Layout A's steps list (F-07.1): short titles, a green check square on each reviewed step, the
 * current step yellow with its number (even when reviewed), the others numbered, "N/M" reviewed
 * in the head and "Skim · N files" at the bottom.
 */
export function StepsList({ steps, current, reviewed, skimFiles, onSelect }: StepsListProps) {
  const done = steps.filter((step) => reviewed.includes(step.id)).length;
  return (
    <nav aria-label="Steps" className={styles.steps}>
      <div className={styles.stepsHead}>
        <span>Steps</span>
        <span className={styles.stepsCount}>
          {done}/{steps.length}
        </span>
      </div>
      {steps.map((step, i) => {
        const on = step.id === current;
        const checked = !on && reviewed.includes(step.id);
        return (
          <button
            key={step.id}
            type="button"
            className={cx(styles.stepRow, on && styles.stepCurrent, checked && styles.stepDone)}
            aria-current={on ? 'step' : undefined}
            onClick={() => {
              onSelect(step.id);
            }}
          >
            <span className={cx(styles.stepNo, checked && styles.stepCheck)}>
              {checked ? <CheckIcon /> : i + 1}
            </span>
            {step.shortTitle}
          </button>
        );
      })}
      {skimFiles > 0 && (
        <div className={styles.skim}>
          <SkimIcon />
          Skim · {skimFiles} {skimFiles === 1 ? 'file' : 'files'}
        </div>
      )}
    </nav>
  );
}
