import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { StepView } from '../types/StepView';
import { stepKey } from './useReview';

/**
 * Several steps of a session at once, under the same keys and options as `useStep` (S-03), so a
 * step read here is the one S-03 and S-04 show and vice versa. No Claude: `review_step` reads the
 * session's cached plan, diff and threads. S-05 uses it to find the step a thread shows in.
 */
export function useStepViews(
  sessionId: string,
  stepIds: readonly string[],
  enabled = true,
): UseQueryResult<StepView, IpcError>[] {
  const ipc = useIpc();
  return useQueries({
    queries: stepIds.map((stepId) => ({
      queryKey: stepKey(sessionId, stepId),
      queryFn: () => ipc.reviewStep(sessionId, stepId),
      enabled: enabled && sessionId !== '' && stepId !== '',
      staleTime: Infinity,
      retry: false,
    })),
  });
}
