import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import type { StartState } from '../../app/router';
import { usePlan } from '../../ipc/hooks/usePlan';
import { stepKey } from '../../ipc/hooks/useReview';
import { useResume, useSessionState, useSessionStateWriter } from '../../ipc/hooks/useSessionState';
import { currentStep } from './currentStep';

/**
 * The session and step that S-03 and S-04 show (F-04.3, F-08.1): the step is `?step=`, else the
 * one the session was on, else step 1 of the reader's order, and is kept for the next start.
 * Restored on start, the step comes from stored data only and no plan is asked for, since an
 * uncached plan would run Claude (F-30.4).
 */
export function useStepSession(sessionId: string) {
  const [params] = useSearchParams();
  const restored = (useLocation().state as StartState | null)?.restored === true;
  const state = useSessionState(sessionId);
  const resumed = useResume(sessionId, restored);
  const { query } = usePlan(sessionId, !restored);
  const writer = useSessionStateWriter(sessionId);
  const queryClient = useQueryClient();
  const view = query.data;
  const order = view?.order.order ?? [];
  const kept = state.data?.currentStep ?? null;
  const stepId = currentStep(params.get('step'), kept, order);
  // The stored state decides the first step and the layout, so the step waits for it.
  const ready = state.data !== undefined || state.isError;

  // The step on screen is kept for the next start (F-04.3).
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

  return { state, view, order, stepId, ready, restored, writer };
}
