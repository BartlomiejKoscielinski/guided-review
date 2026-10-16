import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import { applySettingsPatch, type SettingsPatch } from '../settings-patch';
import type { Settings } from '../types/Settings';
import { UNFINISHED_KEY } from './useUnfinishedSessions';

export const SETTINGS_KEY = ['app', 'settings'] as const;

export function useSettings(): UseQueryResult<Settings, IpcError> {
  const ipc = useIpc();
  return useQuery<Settings, IpcError>({
    queryKey: SETTINGS_KEY,
    queryFn: () => ipc.appSettingsGet(),
  });
}

/** Saves a partial change immediately (S-07: no Save button) and caches the result. */
export function useUpdateSettings(): UseMutationResult<Settings, IpcError, SettingsPatch> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<Settings, IpcError, SettingsPatch>({
    mutationFn: (patch) => ipc.appSettingsSet(patch),
    onSuccess: (settings, patch) => {
      queryClient.setQueryData(SETTINGS_KEY, settings);
      // A session resumes at its own last screen, else where its status and mode lead (F-30.2):
      // the Review tile's list depends on ui.lastRoute and on what that screen changed.
      if (patch.ui?.lastRoute) void queryClient.invalidateQueries({ queryKey: UNFINISHED_KEY });
    },
  });
}

/** The changed shortcuts to save (`ui.shortcuts`: action id → keys) and the settings before. */
interface ShortcutsSave {
  shortcuts: Record<string, string[]>;
  previous: Settings;
}

export interface SaveShortcuts {
  /** Saves the whole map of changed shortcuts (only the changed ones). */
  save: (shortcuts: Record<string, string[]>) => void;
  /** Why the last save failed; the shortcuts are back as they were. */
  error: IpcError | null;
}

const SAVE_SHORTCUTS_KEY = ['app', 'settings', 'shortcuts'] as const;

/**
 * Saves the changed shortcuts at once (F-19.7, S-07: no Save button). The cached settings show
 * them before the core answers, so the keys and hints follow immediately; a settings read on its
 * way is dropped so it can't bring the old keys back. Saves run one after another and only the
 * last one's answer is cached; a failed save puts the settings back as they were.
 */
export function useSaveShortcuts(): SaveShortcuts {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const { mutate, error } = useMutation<Settings, IpcError, ShortcutsSave>({
    mutationKey: SAVE_SHORTCUTS_KEY,
    scope: { id: SAVE_SHORTCUTS_KEY.join('.') },
    mutationFn: ({ shortcuts }) => ipc.appSettingsSet({ ui: { shortcuts } }),
    onSuccess: (settings) => {
      // A later change still on its way keeps its settings in the cache until it answers.
      if (queryClient.isMutating({ mutationKey: SAVE_SHORTCUTS_KEY }) <= 1) {
        queryClient.setQueryData(SETTINGS_KEY, settings);
      }
    },
    onError: (_error, { previous }) => {
      queryClient.setQueryData(SETTINGS_KEY, previous);
    },
  });
  const save = useCallback(
    (shortcuts: Record<string, string[]>) => {
      const previous = queryClient.getQueryData<Settings>(SETTINGS_KEY);
      if (!previous) return;
      queryClient.setQueryData(SETTINGS_KEY, applySettingsPatch(previous, { ui: { shortcuts } }));
      // Cancelling reverts a read on its way to the data just set, not to what it would bring.
      void queryClient.cancelQueries({ queryKey: SETTINGS_KEY, exact: true });
      mutate({ shortcuts, previous });
    },
    [queryClient, mutate],
  );
  return { save, error };
}
