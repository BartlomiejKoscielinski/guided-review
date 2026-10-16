import { useRef } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { Step } from '../../ipc/types/Step';
import { cx } from '../../components/cx';
import { useFocusStore } from '../../state/focus';
import { StepBody } from './StepBody';
import { StepsList } from './StepsList';
import { useSessionLayout } from './useSessionLayout';
import { useStepSession } from './useStepSession';
import styles from './Step.module.css';

/**
 * S-03 Step review in Focus mode, layouts A, B and C (F-07.1): in A the steps list left and the
 * step in the main column, B without the list and with a floating toolbar, C with a guide panel.
 * The current step is `?step=`, else the one the session was on, else step 1 of the reader's
 * order; the step, the layout and each step's scroll position are kept for the next start
 * (F-04.3).
 */
export function StepScreen() {
  const { sessionId = '' } = useParams();
  const [, setParams] = useSearchParams();
  const { state, view, order, stepId, ready, restored, writer } = useStepSession(sessionId);
  useSessionLayout(sessionId, state.data?.layout, writer);
  const mainRef = useRef<HTMLElement>(null);
  const layout = useFocusStore((s) => s.layout);

  const steps = order
    .map((id) => view?.plan.steps.find((s) => s.id === id))
    .filter((s): s is Step => s !== undefined);
  const skimFiles = view?.skimStats.reduce((sum, s) => sum + s.files, 0) ?? 0;
  const go = (id: string) => {
    setParams({ step: id });
  };

  return (
    <div className={styles.screen}>
      {ready && layout === 'A' && steps.length > 0 && stepId !== undefined && (
        <StepsList
          steps={steps}
          current={stepId}
          reviewed={view?.reviewed ?? []}
          skimFiles={skimFiles}
          onSelect={go}
        />
      )}
      {/* review_step needs the plan's remembered context. */}
      {ready && view !== undefined && stepId !== undefined ? (
        <StepBody
          key={stepId}
          sessionId={sessionId}
          stepId={stepId}
          mainRef={mainRef}
          onGo={go}
          restored={restored}
        />
      ) : (
        <main ref={mainRef} className={cx(styles.main)} />
      )}
    </div>
  );
}
