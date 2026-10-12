import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import type { ClaudeStatus } from '../types/ClaudeStatus';
import type { ModelInfo } from '../types/ModelInfo';
import { SETTINGS_KEY } from './useSettings';

export const CLAUDE_STATUS_KEY = ['claude', 'status'] as const;

/** "Claude Code: signed in" and friends (F-18.1); checks run in the core at start. */
export function useClaudeStatus(): UseQueryResult<ClaudeStatus, IpcError> {
  const ipc = useIpc();
  return useQuery<ClaudeStatus, IpcError>({
    queryKey: CLAUDE_STATUS_KEY,
    queryFn: () => ipc.claudeStatus(),
    // The startup check may still be running: ask again until it has an answer.
    refetchInterval: (query) => (query.state.data?.state === 'checking' ? 1000 : false),
  });
}

/** Runs the checks again and caches the new status. */
export function useClaudeRefresh() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<ClaudeStatus, IpcError, undefined>({
    mutationFn: () => ipc.claudeRefresh(),
    onSuccess: (status) => {
      queryClient.setQueryData(CLAUDE_STATUS_KEY, status);
    },
  });
}

/** Sign in to Claude Code: a console with `claude auth login`. */
export function useClaudeSignIn() {
  const ipc = useIpc();
  return useMutation<null, IpcError, undefined>({
    mutationFn: async () => {
      await ipc.claudeSignIn();
      return null;
    },
  });
}

/** Change (F-18.6): pick the executable; settings and status are refreshed. */
export function usePickClaude() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<ClaudeStatus | null, IpcError, undefined>({
    mutationFn: () => ipc.claudePickExecutable(),
    onSuccess: (status) => {
      if (!status) return;
      queryClient.setQueryData(CLAUDE_STATUS_KEY, status);
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

/** The model table from the core (F-18.2, F-18.4). */
export function useClaudeModels(): UseQueryResult<ModelInfo[], IpcError> {
  const ipc = useIpc();
  return useQuery<ModelInfo[], IpcError>({
    queryKey: ['claude', 'models'],
    queryFn: () => ipc.claudeModels(),
    staleTime: Infinity,
  });
}

/**
 * Suggest (F-16.4); the status follows the task result (F-18.1, F-18.7). `onMessage` runs on
 * success even if the screen re-rendered meanwhile.
 */
export function useCommitMessage(onMessage: (message: string) => void) {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<string, IpcError, string>({
    mutationFn: (task) => ipc.claudeCommitMessage(task),
    onSuccess: onMessage,
    onSettled: () => queryClient.invalidateQueries({ queryKey: CLAUDE_STATUS_KEY }),
  });
}
