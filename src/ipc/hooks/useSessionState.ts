import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { Layout } from '../types/Layout';
import type { Mode } from '../types/Mode';
import type { PlanView } from '../types/PlanView';
import type { ResumedSession } from '../types/ResumedSession';
import type { SessionState } from '../types/SessionState';
import { planKey } from './usePlan';
import { findingsKey, stepKey } from './useReview';

export const sessionStateKey = (sessionId: string) => ['session', 'state', sessionId] as const;
export const resumeKey = (sessionId: string) => ['session', 'resume', sessionId] as const;

/**
 * What S-03 keeps of the session (F-04.3): the step it was on, its layout, the scroll position of
 * each step and the checklist ticks. Read once when S-03 opens; the writers update it in place.
 */
export function useSessionState(sessionId: string): UseQueryResult<SessionState, IpcError> {
  const ipc = useIpc();
  return useQuery<SessionState, IpcError>({
    queryKey: sessionStateKey(sessionId),
    queryFn: () => ipc.sessionState(sessionId),
    enabled: sessionId !== '',
    staleTime: Infinity,
  });
}

export interface SessionStateWriter {
  setStep: (stepId: string) => void;
  setLayout: (layout: Layout) => void;
  /** The session's mode (F-08.1); Settings › General › Start in is left alone. */
  setMode: (mode: Mode) => void;
  setScroll: (stepId: string, top: number) => void;
  setChecklist: (stepId: string, ticked: string[]) => void;
  /** S-02 showed the plan: the S-04 rail's "Change overview" is done (F-08.3). */
  markPlanOpened: () => void;
}

/**
 * Writes the session state on change (F-04.3): the cached state follows at once and the core is
 * told in the background. A write that fails is only logged; the review goes on.
 */
export function useSessionStateWriter(sessionId: string): SessionStateWriter {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMemo(() => {
    const update = (change: (state: SessionState) => SessionState) => {
      queryClient.setQueryData<SessionState>(sessionStateKey(sessionId), (old) =>
        old ? change(old) : old,
      );
    };
    const report = (what: string) => (error: unknown) => {
      console.error(`The session's ${what} was not saved.`, error);
    };
    return {
      setStep: (stepId) => {
        update((s) => ({ ...s, currentStep: stepId }));
        ipc.sessionSetStep(sessionId, stepId).catch(report('step'));
      },
      setLayout: (layout) => {
        update((s) => ({ ...s, layout }));
        ipc.sessionSetLayout(sessionId, layout).catch(report('layout'));
      },
      setMode: (mode) => {
        update((s) => ({ ...s, mode }));
        ipc.sessionSetMode(sessionId, mode).catch(report('mode'));
      },
      setScroll: (stepId, top) => {
        const px = Math.max(0, Math.round(top));
        update((s) => ({ ...s, scroll: { ...s.scroll, [stepId]: px } }));
        ipc.sessionSetScroll(sessionId, stepId, px).catch(report('scroll position'));
      },
      setChecklist: (stepId, ticked) => {
        update((s) => ({ ...s, checklist: { ...s.checklist, [stepId]: ticked } }));
        ipc.sessionSetChecklist(sessionId, stepId, ticked).catch(report('checklist'));
      },
      markPlanOpened: () => {
        update((s) => ({ ...s, planOpened: true }));
        ipc.sessionMarkPlanOpened(sessionId).catch(report('opened plan'));
      },
    };
  }, [ipc, queryClient, sessionId]);
}

/**
 * S-03 restored on start (F-04.3, F-30.4): the stored plan, step and notes, put where the plan,
 * step and notes queries read them, so the screen shows the step without asking the core for
 * anything that could run Claude or call GitLab. `null` when the session's plan isn't cached.
 */
export function useResume(
  sessionId: string,
  enabled: boolean,
): UseQueryResult<ResumedSession | null, IpcError> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useQuery<ResumedSession | null, IpcError>({
    queryKey: resumeKey(sessionId),
    queryFn: async () => {
      const resumed = await ipc.sessionResume(sessionId);
      if (resumed) {
        const stepId = resumed.step.step.id;
        queryClient.setQueryData<PlanView>(planKey(sessionId), resumed.plan);
        queryClient.setQueryData(stepKey(sessionId, stepId), resumed.step);
        if (resumed.findings) {
          queryClient.setQueryData(findingsKey(sessionId, stepId), resumed.findings);
        }
      }
      return resumed;
    },
    enabled: enabled && sessionId !== '',
    staleTime: Infinity,
  });
}
