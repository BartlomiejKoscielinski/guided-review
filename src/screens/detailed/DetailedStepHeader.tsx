import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useFinishReview } from '../../app/titlebar/useFinishReview';
import { Button } from '../../components/Button';
import { ChevronLeftIcon, CheckIcon } from '../../components/icons';
import { Kbd } from '../../components/Kbd';
import type { PlanView } from '../../ipc/types/PlanView';
import type { Step } from '../../ipc/types/Step';
import { useMarkReviewed } from '../step/useMarkReviewed';
import { useStepKeys } from '../step/useStepKeys';
import styles from './DetailedStepHeader.module.css';

export interface DetailedStepHeaderProps {
  sessionId: string;
  /** The plan the screen shows: the reader's order and the steps marked reviewed. */
  view: PlanView;
  /** The step on screen. */
  step: Step;
}

/**
 * The S-04 step header (F-08.4, Main.dc.html's main `<section>`): "Step 4 / 8" in the reader's
 * order, "builds on" chips `<number> · <short title>` from `Step.buildsOn` that open that step,
 * Previous step (`[`), Mark reviewed (Space) and Next step (`]`); the H1 title and the description
 * below.
 * On the last step `]` finishes the review (F-30.3) and the button stays disabled, since the end
 * card's Finish review takes its place (F-08.9).
 */
export function DetailedStepHeader({ sessionId, view, step }: DetailedStepHeaderProps) {
  const [, setParams] = useSearchParams();
  const order = view.order.order;
  const index = order.indexOf(step.id);
  const prev = index > 0 ? order[index - 1] : undefined;
  const next = index >= 0 ? order[index + 1] : undefined;
  const last = index >= 0 && index === order.length - 1;
  const position = `Step ${String(index + 1)} / ${String(order.length)}`;
  const reviewed = view.reviewed.includes(step.id);
  const toggleReviewed = useMarkReviewed(sessionId, step.id, reviewed);
  const go = useCallback(
    (id: string) => {
      setParams({ step: id });
    },
    [setParams],
  );
  const finishReview = useFinishReview();
  useStepKeys(prev, next, go, last ? finishReview : undefined);

  const chips = step.buildsOn
    .flatMap((id) => {
      const earlier = view.plan.steps.find((s) => s.id === id);
      const number = order.indexOf(id) + 1;
      return earlier && number > 0 ? [{ id, number, label: earlier.shortTitle }] : [];
    })
    .sort((a, b) => a.number - b.number);

  return (
    <section className={styles.head}>
      <div className={styles.top}>
        <div className={styles.trail}>
          <span className={styles.kicker}>{position}</span>
          {chips.length > 0 && <span className={styles.buildsOn}>builds on</span>}
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={styles.chip}
              onClick={() => {
                go(chip.id);
              }}
            >
              {`${String(chip.number)} · ${chip.label}`}
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.previous}
            aria-label="Previous step"
            disabled={prev === undefined}
            onClick={() => {
              if (prev !== undefined) go(prev);
            }}
          >
            <ChevronLeftIcon size={15} strokeWidth={2.2} />
          </button>
          <Button
            size={36}
            variant={reviewed ? 'approve' : 'neutral'}
            className={styles.mark}
            aria-pressed={reviewed}
            onClick={toggleReviewed}
          >
            <CheckIcon size={14} strokeWidth={2.6} />
            <span>{reviewed ? 'Reviewed' : 'Mark reviewed'}</span>
            <Kbd>Space</Kbd>
          </Button>
          <Button
            size={36}
            className={styles.next}
            disabled={next === undefined}
            onClick={() => {
              if (next !== undefined) go(next);
            }}
          >
            Next step <Kbd>]</Kbd>
          </Button>
        </div>
      </div>
      <h1 className={styles.title}>{step.title}</h1>
      <p className={styles.description}>{step.description}</p>
    </section>
  );
}
