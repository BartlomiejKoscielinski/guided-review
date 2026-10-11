import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useIpc } from '../IpcContext';
import type { IpcError } from '../errors';
import type { AppHealth } from '../types/AppHealth';

export function useAppHealth(): UseQueryResult<AppHealth, IpcError> {
  const ipc = useIpc();
  return useQuery<AppHealth, IpcError>({
    queryKey: ['app', 'health'],
    queryFn: () => ipc.appHealth(),
  });
}
