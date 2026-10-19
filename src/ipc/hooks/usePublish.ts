import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { PublishOutcome } from '../types/PublishOutcome';
import { draftsKey } from './useDrafts';

export const foreignDraftsKey = (sessionId: string) =>
  ['gitlab', 'foreignDrafts', sessionId] as const;

/**
 * The draft comments already in GitLab's own review of the session's MR, which a Publish sends too
 * (F-12.5, M5 decision 8). `enabled` is false on a restored start, which calls no GitLab command
 * (F-30.4).
 */
export function useForeignDrafts(
  sessionId: string,
  enabled: boolean,
): UseQueryResult<number, IpcError> {
  const ipc = useIpc();
  return useQuery<number, IpcError>({
    queryKey: foreignDraftsKey(sessionId),
    queryFn: () => ipc.gitlabForeignDrafts(sessionId),
    enabled: enabled && sessionId !== '',
  });
}

export interface PublishVariables {
  /** The ticked drafts not published yet, in the list's order. */
  ids: string[];
  /** The summary comment's text; null when it doesn't go out. */
  summary: string | null;
  /**
   * The GitLab drafts count the user has seen, asked again right before publishing (decision 8);
   * null skips the check (a restored start, F-30.4).
   */
  seenForeign: number | null;
}

/** `held`: GitLab's own review gained drafts the user hasn't seen; nothing was sent. */
export type PublishResult =
  { kind: 'sent'; outcome: PublishOutcome } | { kind: 'held'; foreign: number };

/**
 * Publish (N) and Retry (F-12.5): one `draftsPublish` for the whole batch. When GitLab's own review
 * holds more drafts than the yellow banner showed, nothing is sent and the banner shows the new
 * count, so nothing reaches GitLab that the user didn't knowingly send (decision 8). The drafts
 * are read again afterwards, so each sent row reads "published" and each failed one its reason.
 */
export function useDraftsPublish(
  sessionId: string,
): UseMutationResult<PublishResult, IpcError, PublishVariables> {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  return useMutation<PublishResult, IpcError, PublishVariables>({
    mutationFn: async ({ ids, summary, seenForeign }) => {
      if (seenForeign !== null) {
        // A count that can't be read doesn't stop Publish: the banner keeps what it showed.
        const now = await ipc.gitlabForeignDrafts(sessionId).catch(() => null);
        if (now !== null) {
          queryClient.setQueryData(foreignDraftsKey(sessionId), now);
          if (now > seenForeign) return { kind: 'held', foreign: now };
        }
      }
      return { kind: 'sent', outcome: await ipc.draftsPublish(sessionId, ids, summary) };
    },
    onSuccess: (result) => {
      // bulk_publish sent every pending draft of the user, the GitLab ones too.
      if (
        result.kind === 'sent' &&
        (result.outcome.published.length > 0 || result.outcome.summary)
      ) {
        queryClient.setQueryData(foreignDraftsKey(sessionId), 0);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: draftsKey(sessionId) }),
  });
}
