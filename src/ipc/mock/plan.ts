import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { Plan } from '../types/Plan';
import type { PlanView } from '../types/PlanView';
import { analysisStatus, type MockStepRuns } from './analysisStatus';
import type { StepOrder } from '../types/StepOrder';
import {
  MOCK_ORDERS,
  MOCK_SKIM_FILES,
  MOCK_SKIM_STATS,
  MOCK_STEP_STATS,
  mockPlan,
} from './fixtures/plan';
import { mockFallbackView } from './fixtures/planFallback';
import { mockStepView } from './fixtures/step';
import { markFile, unmarkFiles } from './fileMarks';
import type { ReviewScenario } from './review';
import type { MockSessionData, SessionData, SessionPlan } from './session-data';

type PlanClient = Pick<
  IpcClient,
  | 'reviewPlan'
  | 'reviewSetStrategy'
  | 'reviewReorderSteps'
  | 'reviewStep'
  | 'reviewMarkStep'
  | 'reviewMarkFile'
  | 'reviewAnalysisStatus'
>;

/** Pause while Claude plans, so S-02's Planning state is visible. */
export const MOCK_PLAN_MS = 1500;
/** When the cached plan of `planCached` was stored: "Plan from cache · <age>". */
export const MOCK_CACHED_AT = '2026-10-13T08:12:00.000Z';

/** The session's steps marked reviewed, in the plan's order. */
export const reviewedIn = (data: SessionData, sessionId: string, plan: Plan): string[] =>
  plan.steps.filter((s) => data.marks[sessionId]?.includes(s.id) === true).map((s) => s.id);

/** The reader's order: the dragged one, else the strategy's. */
export const orderOf = (s: SessionPlan): StepOrder => ({
  strategy: s.strategy,
  custom: s.custom !== null,
  order: [...(s.custom ?? MOCK_ORDERS[s.strategy])],
});

/**
 * A session of commits or local changes (F-17): no MR, so no threads to load. The core loads
 * threads for MR sessions only (review/step_context.rs).
 */
const isSelfReview = (data: SessionData, sessionId: string): boolean =>
  data.local.includes(sessionId);

/** S-02's data of a planned session (the plan is !482's for every session). */
export function plannedView(data: SessionData, sessionId: string, s: SessionPlan): PlanView {
  const plan = mockPlan();
  // A self-review has no threads to summarize (F-17.2).
  if (isSelfReview(data, sessionId)) plan.alreadyDiscussed = '';
  return {
    plan,
    order: orderOf(s),
    stepStats: MOCK_STEP_STATS,
    skimStats: MOCK_SKIM_STATS,
    skimFiles: [[...MOCK_SKIM_FILES]],
    reviewed: reviewedIn(data, sessionId, plan),
    ...(s.cachedAt === null ? {} : { cachedAt: s.cachedAt }),
  };
}

/**
 * S-02's plan of the mock backend (F-06.2, F-06.4, F-06.5, F-06.12): every MR shows !482's plan,
 * with the core's event order (`queued`, `started` unless cached, `done`; `planFails` is done
 * with the file-order fallback), the strategy clearing a dragged order, and the same error copy.
 * S-03's steps (F-07.2, F-07.3) follow the session's order, a fallback plan's too; Mark reviewed
 * keeps the reviewed steps per session (F-07.1, F-07.2). Plans, orders and marks are kept in
 * `store`, so they survive a restart (F-04.3); a fallback plan is never kept.
 */
export function createPlanBackend(
  scenario: ReviewScenario,
  respond: <T>(value: T) => Promise<T>,
  pause: (ms: number) => Promise<void>,
  store: MockSessionData,
  runs: MockStepRuns,
): PlanClient {
  const { data } = store;
  /** The last plan of a session whose plan task failed (the file-order fallback). */
  const fallbacks = new Map<string, PlanView>();

  const notInPlan = () =>
    new IpcError({
      code: 'INVALID_INPUT',
      message: 'The step is not in the plan.',
      retryable: false,
    });

  const keep = (sessionId: string, s: SessionPlan) => {
    data.plans[sessionId] = s;
    store.save();
  };

  /** The session's plan for the toggle and a drag; the fallback plan refuses both, as the core. */
  const ordered = (sessionId: string): SessionPlan => {
    if (fallbacks.has(sessionId)) {
      throw new IpcError({
        code: 'INVALID_INPUT',
        message: "Claude isn't available. You can review in file order.",
        retryable: false,
      });
    }
    return planned(sessionId);
  };

  const planned = (sessionId: string): SessionPlan => {
    const s = data.plans[sessionId];
    if (!s) {
      throw new IpcError({
        code: 'INVALID_INPUT',
        message: "The plan isn't ready yet.",
        retryable: false,
      });
    }
    return s;
  };

  return {
    reviewPlan: async (sessionId, onEvent) => {
      onEvent({ kind: 'queued' });
      let s = data.plans[sessionId];
      if (!s && scenario.planCached) {
        s = { strategy: 'contractToUi', custom: null, cachedAt: MOCK_CACHED_AT };
      }
      if (!s) {
        onEvent({ kind: 'started' });
        await pause(MOCK_PLAN_MS);
        if (scenario.planFails) {
          // The app's file-order fallback; not stored, so Retry runs Claude again.
          const fallback = mockFallbackView({
            code: 'CLAUDE_FAILED',
            message: 'Claude Code failed.',
            retryable: true,
          });
          fallback.reviewed = reviewedIn(data, sessionId, fallback.plan);
          if (isSelfReview(data, sessionId)) fallback.plan.alreadyDiscussed = '';
          fallbacks.set(sessionId, fallback);
          onEvent({ kind: 'done', result: structuredClone(fallback) });
          return respond(fallback);
        }
        s = { strategy: 'contractToUi', custom: null, cachedAt: null };
      }
      const view = plannedView(data, sessionId, s);
      // Opening S-02 again reads the plan from the cache.
      fallbacks.delete(sessionId);
      keep(sessionId, { ...s, cachedAt: s.cachedAt ?? new Date().toISOString() });
      onEvent({ kind: 'done', result: structuredClone(view) });
      return respond(view);
    },
    reviewStep: (sessionId, stepId) => {
      try {
        const fallback = fallbacks.get(sessionId);
        const reviewed = data.marks[sessionId]?.includes(stepId) === true;
        const view = fallback
          ? mockStepView(fallback.plan, fallback.order.order, stepId, reviewed, true)
          : mockStepView(mockPlan(), orderOf(planned(sessionId)).order, stepId, reviewed, false);
        if (!view) throw notInPlan();
        if (isSelfReview(data, sessionId)) view.threads = [];
        return respond(view);
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    reviewMarkStep: (sessionId, stepId, reviewed) => {
      try {
        const fallback = fallbacks.get(sessionId);
        if (!fallback) planned(sessionId); // "The plan isn't ready yet."
        const plan = fallback?.plan ?? mockPlan();
        if (!plan.steps.some((s) => s.id === stepId)) throw notInPlan();
        const marked = new Set(data.marks[sessionId] ?? []);
        if (reviewed) marked.add(stepId);
        else marked.delete(stepId);
        data.marks[sessionId] = [...marked];
        // All its files or none (F-07.10): the undo takes back the files marked on their own.
        if (!reviewed) unmarkFiles(data, sessionId, stepId);
        store.save();
        return respond(reviewedIn(data, sessionId, plan));
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    reviewMarkFile: (sessionId, stepId, file, reviewed) => {
      try {
        // The same guards as Mark reviewed: the plan first, then the step, then the file.
        const fallback = fallbacks.get(sessionId);
        if (!fallback) planned(sessionId); // "The plan isn't ready yet."
        const plan = fallback?.plan ?? mockPlan();
        const step = plan.steps.find((s) => s.id === stepId);
        if (!step) throw notInPlan();
        markFile(data, sessionId, step, file, reviewed);
        store.save();
        return respond(reviewedIn(data, sessionId, plan));
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    reviewAnalysisStatus: (sessionId) => {
      try {
        // The fallback plan's order or the planned one's; "The plan isn't ready yet." before.
        const order = fallbacks.get(sessionId)?.order.order ?? orderOf(planned(sessionId)).order;
        return respond(analysisStatus(data, runs, sessionId, order));
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    reviewSetStrategy: (sessionId, strategy) => {
      try {
        const s = { ...ordered(sessionId), strategy, custom: null };
        keep(sessionId, s);
        return respond(orderOf(s));
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    reviewReorderSteps: (sessionId, stepIds) => {
      try {
        const s = ordered(sessionId);
        const steps = MOCK_ORDERS.contractToUi;
        const unique = new Set(stepIds);
        if (stepIds.length !== steps.length || !steps.every((id) => unique.has(id))) {
          throw new IpcError({
            code: 'INVALID_INPUT',
            message: "The order doesn't match the plan's steps.",
            retryable: false,
          });
        }
        const next = { ...s, custom: [...stepIds] };
        keep(sessionId, next);
        return respond(orderOf(next));
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
  };
}
