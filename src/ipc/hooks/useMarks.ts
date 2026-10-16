import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { PlanView } from '../types/PlanView';
import type { SessionState } from '../types/SessionState';
import type { StepView } from '../types/StepView';
import { planKey } from './usePlan';
import { stepKey } from './useReview';
import { sessionStateKey } from './useSessionState';

export interface MarkStepVariables {
  stepId: string;
  reviewed: boolean;
}

export interface MarkFileVariables {
  stepId: string;
  /** The file's path in the step. */
  file: string;
  reviewed: boolean;
  /** The paths of the step's files in the diff's order. */
  paths: readonly string[];
}

/** The plan's reviewed steps and the step's flag follow the core's answer. */
function followSteps(
  queryClient: QueryClient,
  sessionId: string,
  stepId: string,
  marked: string[],
) {
  queryClient.setQueryData<PlanView>(planKey(sessionId), (old) =>
    old ? { ...old, reviewed: marked } : old,
  );
  queryClient.setQueryData<StepView>(stepKey(sessionId, stepId), (old) =>
    old ? { ...old, reviewed: marked.includes(stepId) } : old,
  );
}

/** The step's files marked on their own in the cached session state (none: the step's entry goes). */
function setFiles(queryClient: QueryClient, sessionId: string, stepId: string, files: string[]) {
  queryClient.setQueryData<SessionState>(sessionStateKey(sessionId), (old) => {
    if (!old) return old;
    const others = Object.entries(old.reviewedFiles).filter(([step]) => step !== stepId);
    const reviewedFiles = Object.fromEntries(
      files.length > 0 ? [...others, [stepId, files]] : others,
    );
    return { ...old, reviewedFiles };
  });
}

/** The step was reviewed before the core's answer: its step view's flag, else the plan's. */
function wasReviewed(queryClient: QueryClient, sessionId: string, stepId: string): boolean {
  const step = queryClient.getQueryData<StepView>(stepKey(sessionId, stepId));
  if (step) return step.reviewed;
  const plan = queryClient.getQueryData<PlanView>(planKey(sessionId));
  return plan?.reviewed.includes(stepId) ?? false;
}

/**
 * The step's files marked reviewed after one file was marked or taken back, as the core keeps
 * them (`review/progress.rs`): a reviewed step starts from all its files, any other from the
 * ones marked on their own.
 */
export function filesAfterMark(
  paths: readonly string[],
  marked: readonly string[],
  stepReviewed: boolean,
  file: string,
  reviewed: boolean,
): string[] {
  const after = new Set((stepReviewed ? paths : marked).filter((p) => p !== file));
  if (reviewed) after.add(file);
  return paths.filter((p) => after.has(p));
}

/**
 * Mark reviewed or its undo (F-07.2, F-07.10): the step's flag, the steps list's checks and the
 * progress segments (F-07.1) follow the session's stored marks the core returns; the undo takes
 * back every file mark of the step. No Claude.
 */
export function useMarkStep(
  sessionId: string,
): UseMutationResult<string[], IpcError, MarkStepVariables> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<string[], IpcError, MarkStepVariables>({
    mutationFn: ({ stepId, reviewed }) => ipc.reviewMarkStep(sessionId, stepId, reviewed),
    onSuccess: (marked, { stepId, reviewed }) => {
      followSteps(queryClient, sessionId, stepId, marked);
      if (!reviewed) setFiles(queryClient, sessionId, stepId, []);
    },
  });
}

/**
 * A file's Reviewed toggle or Space (F-07.10): one file of the step marked or taken back; the
 * step's flag and the plan's reviewed steps follow the core's answer, and the session state's
 * files follow the mark. No Claude.
 */
export function useMarkFile(
  sessionId: string,
): UseMutationResult<string[], IpcError, MarkFileVariables> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<string[], IpcError, MarkFileVariables>({
    mutationFn: ({ stepId, file, reviewed }) =>
      ipc.reviewMarkFile(sessionId, stepId, file, reviewed),
    onSuccess: (marked, { stepId, file, reviewed, paths }) => {
      const state = queryClient.getQueryData<SessionState>(sessionStateKey(sessionId));
      const before = state?.reviewedFiles[stepId] ?? [];
      const stepReviewed = wasReviewed(queryClient, sessionId, stepId);
      setFiles(
        queryClient,
        sessionId,
        stepId,
        filesAfterMark(paths, before, stepReviewed, file, reviewed),
      );
      followSteps(queryClient, sessionId, stepId, marked);
    },
  });
}
