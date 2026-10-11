import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import type { SettingsPatch } from '../settings-patch';
import type { Settings } from '../types/Settings';

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
    onSuccess: (settings) => {
      queryClient.setQueryData(SETTINGS_KEY, settings);
    },
  });
}
