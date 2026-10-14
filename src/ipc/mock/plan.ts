import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { Plan } from '../types/Plan';
import type { PlanView } from '../types/PlanView';
import type { StepOrder } from '../types/StepOrder';
import type { Strategy } from '../types/Strategy';
import {
  MOCK_ORDERS,
  MOCK_SKIM_FILES,
  MOCK_SKIM_STATS,
  MOCK_STEP_STATS,
  mockPlan,
} from './fixtures/plan';
import { mockFallbackView } from './fixtures/planFallback';
import { mockStepView } from './fixtures/step';
import type { ReviewScenario } from './review';

type PlanClient = Pick<
  IpcClient,
  'reviewPlan' | 'reviewSetStrategy' | 'reviewReorderSteps' | 'reviewStep' | 'reviewMarkStep'
>;

/** Pause while Claude plans, so S-02's Planning state is visible. */
export const MOCK_PLAN_MS = 1500;
/** When the cached plan of `planCached` was stored: "Plan from cache · <age>". */
export const MOCK_CACHED_AT = '2026-10-13T08:12:00.000Z';

interface SessionPlan {
  strategy: Strategy;
  custom: string[] | null;
  cachedAt: string | null;
}

/**
 * S-02's plan of the mock backend (F-06.2, F-06.4, F-06.5, F-06.12): every MR shows !482's plan,
 * with the core's event order (`queued`, `started` unless cached, `done`; `planFails` is done
 * with the file-order fallback), the strategy clearing a dragged order, and the same error copy.
 * S-03's steps (F-07.2, F-07.3) follow the session's order, a fallback plan's too; Mark reviewed
 * keeps the reviewed steps per session (F-07.1, F-07.2).
 */
export function createPlanBackend(
  scenario: ReviewScenario,
  respond: <T>(value: T) => Promise<T>,
  pause: (ms: number) => Promise<void>,
): PlanClient {
  const sessions = new Map<string, SessionPlan>();
  /** The last plan of a session whose plan task failed (the file-order fallback). */
  const fallbacks = new Map<string, PlanView>();
  /** Steps marked reviewed per session. */
  const marks = new Map<string, Set<string>>();

  const reviewedIn = (sessionId: string, plan: Plan): string[] =>
    plan.steps.filter((s) => marks.get(sessionId)?.has(s.id) === true).map((s) => s.id);

  const notInPlan = () =>
    new IpcError({
      code: 'INVALID_INPUT',
      message: 'The step is not in the plan.',
      retryable: false,
    });

  const order = (s: SessionPlan): StepOrder => ({
    strategy: s.strategy,
    custom: s.custom !== null,
    order: [...(s.custom ?? MOCK_ORDERS[s.strategy])],
  });

  const planned = (sessionId: string): SessionPlan => {
    const s = sessions.get(sessionId);
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
      let s = sessions.get(sessionId);
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
          fallback.reviewed = reviewedIn(sessionId, fallback.plan);
          fallbacks.set(sessionId, fallback);
          onEvent({ kind: 'done', result: structuredClone(fallback) });
          return respond(fallback);
        }
        s = { strategy: 'contractToUi', custom: null, cachedAt: null };
      }
      const plan = mockPlan();
      const view: PlanView = {
        plan,
        order: order(s),
        stepStats: MOCK_STEP_STATS,
        skimStats: MOCK_SKIM_STATS,
        skimFiles: [[...MOCK_SKIM_FILES]],
        reviewed: reviewedIn(sessionId, plan),
        ...(s.cachedAt === null ? {} : { cachedAt: s.cachedAt }),
      };
      // Opening S-02 again reads the plan from the cache.
      fallbacks.delete(sessionId);
      sessions.set(sessionId, { ...s, cachedAt: s.cachedAt ?? new Date().toISOString() });
      onEvent({ kind: 'done', result: structuredClone(view) });
      return respond(view);
    },
    reviewStep: (sessionId, stepId) => {
      try {
        const fallback = fallbacks.get(sessionId);
        const reviewed = marks.get(sessionId)?.has(stepId) === true;
        const view = fallback
          ? mockStepView(fallback.plan, fallback.order.order, stepId, reviewed, true)
          : mockStepView(mockPlan(), order(planned(sessionId)).order, stepId, reviewed, false);
        if (!view) throw notInPlan();
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
        const set = marks.get(sessionId) ?? new Set<string>();
        if (reviewed) set.add(stepId);
        else set.delete(stepId);
        marks.set(sessionId, set);
        return respond(reviewedIn(sessionId, plan));
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    reviewSetStrategy: (sessionId, strategy) => {
      try {
        const s = { ...planned(sessionId), strategy, custom: null };
        sessions.set(sessionId, s);
        return respond(order(s));
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    reviewReorderSteps: (sessionId, stepIds) => {
      try {
        const s = planned(sessionId);
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
        sessions.set(sessionId, next);
        return respond(order(next));
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
  };
}
