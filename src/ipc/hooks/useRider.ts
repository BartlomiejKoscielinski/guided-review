import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import type { RiderStatus } from '../types/RiderStatus';
import { SETTINGS_KEY } from './useSettings';

export const RIDER_STATUS_KEY = ['rider', 'status'] as const;

/** The Rider install the app uses (F-24.4). */
export function useRiderStatus(): UseQueryResult<RiderStatus, IpcError> {
  const ipc = useIpc();
  return useQuery<RiderStatus, IpcError>({
    queryKey: RIDER_STATUS_KEY,
    queryFn: () => ipc.riderStatus(),
  });
}

/** Change: pick `rider64.exe`; settings and status are refreshed. */
export function usePickRider() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<RiderStatus | null, IpcError, undefined>({
    mutationFn: () => ipc.riderPickExecutable(),
    onSuccess: (status) => {
      if (!status) return;
      queryClient.setQueryData(RIDER_STATUS_KEY, status);
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}
