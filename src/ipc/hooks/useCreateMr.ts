import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { CreatedMr } from '../types/CreatedMr';
import type { CreateMrRequest } from '../types/CreateMrRequest';
import { LOCAL_KEY } from './useChanges';

/**
 * **Create merge request** / **Create draft MR** of S-11 (F-27.6): one request per click, never
 * retried; afterwards "Before you create" reads again, so the branch's new MR is its open MR.
 */
export function useCreateMr() {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<CreatedMr, IpcError, CreateMrRequest>({
    mutationFn: (request) => ipc.gitlabCreateMr(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LOCAL_KEY, 'merge-check'] });
    },
  });
}
