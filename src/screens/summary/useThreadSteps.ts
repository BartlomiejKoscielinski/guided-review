import { useStepViews } from '../../ipc/hooks/useStepViews';
import { useStepProgress } from '../step/useStepProgress';

/**
 * The step each thread shows in (M5 decisions 4 and 13), by discussion id: the first step in the
 * reader's order that has it under a line of its hunks or on a file header, as the core placed
 * it. A thread no step shows (a file no longer in the MR, a comment on the MR itself) is not in
 * the map, nor is any while the steps are being read. It reads the plan the steps screen cached
 * and never starts one (F-30.4); without a plan (`enabled` false, or none cached) the map is
 * empty.
 */
export function useThreadSteps(sessionId: string, enabled: boolean): ReadonlyMap<string, string> {
  const { order } = useStepProgress(sessionId);
  const views = useStepViews(sessionId, enabled ? order : [], enabled);
  const steps = new Map<string, string>();
  order.forEach((stepId, i) => {
    const view = views[i]?.data;
    if (!view) return;
    for (const thread of [...view.threads, ...view.fileThreads]) {
      if (!steps.has(thread.id)) steps.set(thread.id, stepId);
    }
  });
  return steps;
}
