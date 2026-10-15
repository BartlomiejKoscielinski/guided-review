import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { Draft } from '../types/Draft';
import type { DraftPatch } from '../types/DraftPatch';
import type { NewDraft } from '../types/NewDraft';

export const draftsKey = (sessionId: string) => ['drafts', sessionId] as const;

/** The session's local drafts in the order they were made (F-09.2). */
export function useDrafts(sessionId: string): UseQueryResult<Draft[], IpcError> {
  const ipc = useIpc();
  return useQuery<Draft[], IpcError>({
    queryKey: draftsKey(sessionId),
    queryFn: () => ipc.draftsList(sessionId),
    enabled: sessionId !== '',
  });
}

/** A draft from the answer card or a free comment (F-10.3). */
export function useCreateDraft(): UseMutationResult<Draft, IpcError, NewDraft> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<Draft, IpcError, NewDraft>({
    mutationFn: (draft) => ipc.draftsCreate(draft),
    onSuccess: (draft) => queryClient.invalidateQueries({ queryKey: draftsKey(draft.sessionId) }),
  });
}

export interface UpdateDraftVariables {
  id: string;
  patch: DraftPatch;
}

export function useUpdateDraft(): UseMutationResult<Draft, IpcError, UpdateDraftVariables> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<Draft, IpcError, UpdateDraftVariables>({
    mutationFn: ({ id, patch }) => ipc.draftsUpdate(id, patch),
    onSuccess: (draft) => queryClient.invalidateQueries({ queryKey: draftsKey(draft.sessionId) }),
  });
}

export function useDeleteDraft(sessionId: string): UseMutationResult<null, IpcError, string> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<null, IpcError, string>({
    mutationFn: async (id) => {
      await ipc.draftsDelete(id);
      return null;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: draftsKey(sessionId) }),
  });
}
