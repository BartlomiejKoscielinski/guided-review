import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';
import type { StartState } from '../../app/router';
import { usePlan } from '../../ipc/hooks/usePlan';
import { stepKey } from '../../ipc/hooks/useReview';
import { useResume, useSessionState, useSessionStateWriter } from '../../ipc/hooks/useSessionState';
import type { Step } from '../../ipc/types/Step';
import { cx } from '../../components/cx';
import { useFocusStore } from '../../state/focus';
import { currentStep } from './currentStep';
import { StepBody } from './StepBody';
import { StepsList } from './StepsList';
import { useSessionLayout } from './useSessionLayout';
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
  const [params, setParams] = useSearchParams();
  // Restored on start: the step comes from stored data only and no plan is asked for, since an
  // uncached plan would run Claude (F-30.4).
  const restored = (useLocation().state as StartState | null)?.restored === true;
  const state = useSessionState(sessionId);
  const resumed = useResume(sessionId, restored);
  const { query } = usePlan(sessionId, !restored);
  const writer = useSessionStateWriter(sessionId);
  useSessionLayout(sessionId, state.data?.layout, writer);
  const queryClient = useQueryClient();
  const mainRef = useRef<HTMLElement>(null);
  const layout = useFocusStore((s) => s.layout);
  const view = query.data;
  const order = view?.order.order ?? [];
  const kept = state.data?.currentStep ?? null;
  const stepId = currentStep(params.get('step'), kept, order);
  // The stored state decides the first step and the layout, so the step waits for it.
  const ready = state.data !== undefined || state.isError;

  // The step S-03 is on is kept for the next start (F-04.3).
  const shown = stepId !== undefined && order.includes(stepId) ? stepId : null;
  const loaded = state.data !== undefined;
  useEffect(() => {
    if (loaded && shown !== null && shown !== kept) writer.setStep(shown);
  }, [loaded, shown, kept, writer]);

  // The restored step came without the MR's threads (F-30.4): opening it again loads them.
  const resumedStep = resumed.data?.step.step.id;
  useEffect(() => {
    if (!restored && resumedStep !== undefined) {
      void queryClient.invalidateQueries({
        queryKey: stepKey(sessionId, resumedStep),
        exact: true,
        refetchType: 'none',
      });
    }
  }, [queryClient, restored, resumedStep, sessionId]);

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
