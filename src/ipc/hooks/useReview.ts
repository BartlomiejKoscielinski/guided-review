import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { AskAnswer } from '../types/AskAnswer';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';
import type { DecisionOutcome } from '../types/DecisionOutcome';
import type { FindingDecision } from '../types/FindingDecision';
import type { LineSelection } from '../types/LineSelection';
import type { StepAnalysis } from '../types/StepAnalysis';
import type { StepView } from '../types/StepView';
import { CLAUDE_STATUS_KEY } from './useClaude';
import { draftsKey } from './useDrafts';

export const findingsKey = (sessionId: string, stepId: string) =>
  ['review', 'findings', sessionId, stepId] as const;
/** Every step of a session; a new step order invalidates them ("STEP n OF m", prev, next). */
export const stepsKey = (sessionId: string) => ['review', 'step', sessionId] as const;
export const stepKey = (sessionId: string, stepId: string) =>
  [...stepsKey(sessionId), stepId] as const;

/**
 * A step of S-03 (F-07.2, F-07.3): header numbers in the reader's order, its files with only its
 * hunks, read-only threads and the reviewed flag. No Claude, so it is there before the notes.
 */
export function useStep(sessionId: string, stepId: string): UseQueryResult<StepView, IpcError> {
  const ipc = useIpc();
  return useQuery<StepView, IpcError>({
    queryKey: stepKey(sessionId, stepId),
    queryFn: () => ipc.reviewStep(sessionId, stepId),
    enabled: sessionId !== '' && stepId !== '',
    staleTime: Infinity,
    retry: false,
  });
}

/** Where a Claude task is: S-03's "Claude is reading this step…" while `queued` or `started`. */
export type TaskPhase = ClaudeTaskEvent<unknown>['kind'] | 'idle';

/**
 * A step's notes (F-09.6), cached per session and step; `refetch` is Retry. The core prefetches
 * the next step, so opening it is usually instant.
 */
export function useStepFindings(
  sessionId: string,
  stepId: string,
): { query: UseQueryResult<StepAnalysis, IpcError>; phase: TaskPhase } {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<TaskPhase>('idle');
  const query = useQuery<StepAnalysis, IpcError>({
    queryKey: findingsKey(sessionId, stepId),
    queryFn: async () => {
      try {
        return await ipc.reviewFindings(sessionId, stepId, (event) => {
          if (event.kind !== 'partialText') setPhase(event.kind);
        });
      } finally {
        void queryClient.invalidateQueries({ queryKey: CLAUDE_STATUS_KEY });
      }
    },
    enabled: sessionId !== '' && stepId !== '',
    staleTime: Infinity,
    retry: false,
  });
  return { query, phase };
}

export interface AskVariables {
  question: string;
  selection: LineSelection | null;
}

/**
 * Questions on a step (F-10.1, F-10.2): `text` grows with each streamed piece and is replaced
 * by the whole answer at the end; asking again on the step is a follow-up.
 */
export function useAsk(
  sessionId: string,
  stepId: string,
): {
  mutation: UseMutationResult<AskAnswer, IpcError, AskVariables>;
  text: string;
  phase: TaskPhase;
} {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<TaskPhase>('idle');
  const onEvent = useCallback((event: ClaudeTaskEvent<AskAnswer>) => {
    setPhase(event.kind);
    if (event.kind === 'partialText') setText((t) => t + event.text);
    if (event.kind === 'done') setText(event.result.text);
  }, []);
  const mutation = useMutation<AskAnswer, IpcError, AskVariables>({
    mutationFn: ({ question, selection }) => {
      setText('');
      return ipc.reviewAsk(sessionId, stepId, question, selection, onEvent);
    },
    onError: () => {
      setPhase('failed');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CLAUDE_STATUS_KEY }),
  });
  return { mutation, text, phase };
}

export interface DecideVariables {
  findingId: string;
  decision: FindingDecision;
}

/** A decision on a note (F-09.2): the cached step notes and the drafts list follow it. */
export function useDecide(
  sessionId: string,
): UseMutationResult<DecisionOutcome, IpcError, DecideVariables> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<DecisionOutcome, IpcError, DecideVariables>({
    mutationFn: ({ findingId, decision }) => ipc.reviewDecide(findingId, decision),
    onSuccess: ({ finding }) => {
      queryClient.setQueryData<StepAnalysis>(findingsKey(sessionId, finding.stepId), (old) =>
        old
          ? { ...old, findings: old.findings.map((f) => (f.id === finding.id ? finding : f)) }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: draftsKey(sessionId) });
    },
  });
}
