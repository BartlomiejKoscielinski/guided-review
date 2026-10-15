import { usePlan } from '../../ipc/hooks/usePlan';

const NONE: readonly string[] = [];

/**
 * The reader's order and the steps marked reviewed, read from the session's cached plan (F-07.1):
 * what the steps list, the title-bar segments and the guide panel's segments show. This never
 * starts a plan (F-30.4); until the plan is there both lists are empty.
 */
export function useStepProgress(sessionId: string): {
  order: readonly string[];
  reviewed: readonly string[];
} {
  const plan = usePlan(sessionId, false).query.data;
  return { order: plan?.order.order ?? NONE, reviewed: plan?.reviewed ?? NONE };
}
