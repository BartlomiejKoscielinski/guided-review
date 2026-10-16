import type { IpcClient } from '../client';
import type { Layout } from '../types/Layout';
import type { Mode } from '../types/Mode';
import type { ResumedSession } from '../types/ResumedSession';
import type { SessionState } from '../types/SessionState';
import { mockPlan } from './fixtures/plan';
import { mockStepView } from './fixtures/step';
import { reviewedFilesOf } from './fileMarks';
import { plannedView } from './plan';
import { cachedFindings } from './review';
import { stateOf, type MockSessionData } from './session-data';

type StateClient = Pick<
  IpcClient,
  | 'sessionState'
  | 'sessionSetStep'
  | 'sessionSetLayout'
  | 'sessionSetMode'
  | 'sessionMarkPlanOpened'
  | 'sessionSetScroll'
  | 'sessionSetChecklist'
  | 'sessionResume'
>;

/**
 * What S-03 keeps of a session in the mock backend (F-04.3): the current step, the layout, the
 * mode (F-08.1), whether S-02 showed the plan (F-08.3), the scroll position per step and the
 * checklist ticks, kept in `store` like the core keeps them in SQLite. Any session ID has a state
 * (every session of the mock has !482's plan); one that was never opened reads in the layout
 * `ui.focusLayout` and the mode `ui.startIn` name. `sessionResume` is S-03 restored on start:
 * stored data only, the step without threads, the notes only when analyzed (F-30.4).
 */
export function createStateBackend(
  respond: <T>(value: T) => Promise<T>,
  store: MockSessionData,
  focusLayout: () => Layout,
  startIn: () => Mode,
): StateClient {
  const { data } = store;
  const write = (apply: () => void): Promise<void> => {
    apply();
    store.save();
    return respond(undefined);
  };

  return {
    sessionState: (sessionId) => {
      const stored = data.states[sessionId];
      const state: SessionState = {
        currentStep: stored?.currentStep ?? null,
        layout: stored?.layout ?? focusLayout(),
        mode: stored?.mode ?? startIn(),
        scroll: { ...stored?.scroll },
        checklist: Object.fromEntries(
          Object.entries(stored?.checklist ?? {}).filter(([, ticked]) => ticked.length > 0),
        ),
        planOpened: stored?.planOpened === true,
        reviewedFiles: reviewedFilesOf(data, sessionId),
      };
      return respond(state);
    },
    sessionSetStep: (sessionId, stepId) =>
      write(() => {
        stateOf(data, sessionId).currentStep = stepId;
      }),
    sessionSetLayout: (sessionId, layout) =>
      write(() => {
        stateOf(data, sessionId).layout = layout;
      }),
    sessionSetMode: (sessionId, mode) =>
      write(() => {
        stateOf(data, sessionId).mode = mode;
      }),
    sessionMarkPlanOpened: (sessionId) =>
      write(() => {
        stateOf(data, sessionId).planOpened = true;
      }),
    sessionSetScroll: (sessionId, stepId, top) =>
      write(() => {
        stateOf(data, sessionId).scroll[stepId] = Math.max(0, Math.round(top));
      }),
    sessionSetChecklist: (sessionId, stepId, ticked) =>
      write(() => {
        stateOf(data, sessionId).checklist[stepId] = [...ticked];
      }),
    sessionResume: (sessionId) => {
      const planned = data.plans[sessionId];
      if (!planned) return respond(null);
      const plan = plannedView(data, sessionId, planned);
      const order = plan.order.order;
      const stored = data.states[sessionId]?.currentStep;
      const stepId =
        stored !== undefined && stored !== null && order.includes(stored) ? stored : order[0];
      const step =
        stepId === undefined
          ? undefined
          : mockStepView(
              mockPlan(),
              order,
              stepId,
              plan.reviewed.includes(stepId),
              false,
              data.threads,
            );
      if (stepId === undefined || !step) return respond(null);
      const findings = cachedFindings(data, sessionId, stepId);
      store.save();
      const resumed: ResumedSession = {
        plan,
        step: { ...step, threads: [], fileThreads: [] },
        findings,
      };
      return respond(resumed);
    },
  };
}
