import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { PlanView } from '../types/PlanView';
import type { StepOrder } from '../types/StepOrder';
import type { Strategy } from '../types/Strategy';
import { MOCK_ORDERS, MOCK_SKIM_STATS, MOCK_STEP_STATS, mockPlan } from './fixtures/plan';
import type { ReviewScenario } from './review';

type PlanClient = Pick<IpcClient, 'reviewPlan' | 'reviewSetStrategy' | 'reviewReorderSteps'>;

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
 * with the core's event order (`queued`, `started` unless cached, `done`/`failed`), the strategy
 * clearing a dragged order, and the same error copy.
 */
export function createPlanBackend(
  scenario: ReviewScenario,
  respond: <T>(value: T) => Promise<T>,
  pause: (ms: number) => Promise<void>,
): PlanClient {
  const sessions = new Map<string, SessionPlan>();

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
          const failure = new IpcError({
            code: 'CLAUDE_FAILED',
            message: 'Claude Code failed.',
            retryable: true,
          });
          onEvent({
            kind: 'failed',
            error: { code: failure.code, message: failure.message, retryable: true },
          });
          throw failure;
        }
        s = { strategy: 'contractToUi', custom: null, cachedAt: null };
      }
      const view: PlanView = {
        plan: mockPlan(),
        order: order(s),
        stepStats: MOCK_STEP_STATS,
        skimStats: MOCK_SKIM_STATS,
        ...(s.cachedAt === null ? {} : { cachedAt: s.cachedAt }),
      };
      // Opening S-02 again reads the plan from the cache.
      sessions.set(sessionId, { ...s, cachedAt: s.cachedAt ?? new Date().toISOString() });
      onEvent({ kind: 'done', result: structuredClone(view) });
      return respond(view);
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
