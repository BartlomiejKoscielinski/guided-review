import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useState } from 'react';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { PlanView } from '../types/PlanView';
import type { StepOrder } from '../types/StepOrder';
import type { Strategy } from '../types/Strategy';
import { CLAUDE_STATUS_KEY } from './useClaude';
import { stepsKey, type TaskPhase } from './useReview';

export const planKey = (sessionId: string) => ['review', 'plan', sessionId] as const;

const setOrder = (queryClient: QueryClient, sessionId: string, order: StepOrder) => {
  queryClient.setQueryData<PlanView>(planKey(sessionId), (old) => (old ? { ...old, order } : old));
  void queryClient.invalidateQueries({ queryKey: stepsKey(sessionId) });
};

/**
 * S-02's plan (F-06.2), cached per session; `phase` drives the Planning state and the title bar
 * status (F-06.12), `refetch` is Retry.
 */
export function usePlan(sessionId: string): {
  query: UseQueryResult<PlanView, IpcError>;
  phase: TaskPhase;
} {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<TaskPhase>('idle');
  const query = useQuery<PlanView, IpcError>({
    queryKey: planKey(sessionId),
    queryFn: async () => {
      try {
        return await ipc.reviewPlan(sessionId, (event) => {
          if (event.kind !== 'partialText') setPhase(event.kind);
        });
      } finally {
        void queryClient.invalidateQueries({ queryKey: CLAUDE_STATUS_KEY });
      }
    },
    enabled: sessionId !== '',
    staleTime: Infinity,
    retry: false,
  });
  return { query, phase };
}

/** The strategy toggle (F-06.4): the plan's order follows; no Claude call. */
export function useSetStrategy(
  sessionId: string,
): UseMutationResult<StepOrder, IpcError, Strategy> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<StepOrder, IpcError, Strategy>({
    mutationFn: (strategy) => ipc.reviewSetStrategy(sessionId, strategy),
    onSuccess: (order) => {
      setOrder(queryClient, sessionId, order);
    },
  });
}

/**
 * A dropped row (F-06.5): the rows move at once and go back if the core refuses the order.
 */
export function useReorderSteps(
  sessionId: string,
): UseMutationResult<StepOrder, IpcError, string[], { previous: StepOrder | undefined }> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<StepOrder, IpcError, string[], { previous: StepOrder | undefined }>({
    mutationFn: (stepIds) => ipc.reviewReorderSteps(sessionId, stepIds),
    onMutate: (stepIds) => {
      const previous = queryClient.getQueryData<PlanView>(planKey(sessionId))?.order;
      if (previous) setOrder(queryClient, sessionId, { ...previous, custom: true, order: stepIds });
      return { previous };
    },
    onError: (_error, _stepIds, context) => {
      if (context?.previous) setOrder(queryClient, sessionId, context.previous);
    },
    onSuccess: (order) => {
      setOrder(queryClient, sessionId, order);
    },
  });
}
