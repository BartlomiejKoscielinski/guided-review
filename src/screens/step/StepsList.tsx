import { cx } from '../../components/cx';
import { SkimIcon } from '../../components/icons';
import type { Step } from '../../ipc/types/Step';
import styles from './Step.module.css';

export interface StepsListProps {
  /** The plan's steps in the reader's order. */
  steps: Step[];
  current: string;
  /** Files in the skim groups: "Skim · N files". */
  skimFiles: number;
  onSelect: (stepId: string) => void;
}

/**
 * Layout A's steps list (F-07.1): short titles, the current step yellow, the others numbered,
 * "Skim · N files" at the bottom. Done checks come with `review_mark_step`.
 */
export function StepsList({ steps, current, skimFiles, onSelect }: StepsListProps) {
  return (
    <nav aria-label="Steps" className={styles.steps}>
      <div className={styles.stepsHead}>Steps</div>
      {steps.map((step, i) => {
        const on = step.id === current;
        return (
          <button
            key={step.id}
            type="button"
            className={cx(styles.stepRow, on && styles.stepCurrent)}
            aria-current={on ? 'step' : undefined}
            onClick={() => {
              onSelect(step.id);
            }}
          >
            <span className={styles.stepNo}>{i + 1}</span>
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
