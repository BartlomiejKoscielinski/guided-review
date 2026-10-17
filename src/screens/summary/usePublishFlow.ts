import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { IpcError } from '../../ipc/errors';
import { useDraftsPublish, useForeignDrafts } from '../../ipc/hooks/usePublish';
import { useIpc } from '../../ipc/IpcContext';
import type { Draft } from '../../ipc/types/Draft';
import type { PublishOutcome } from '../../ipc/types/PublishOutcome';
import type { SummaryField } from '../../ipc/types/SummaryField';

export interface PublishFlow {
  /** N of Publish (N): the ticked drafts not published yet; the summary comment isn't counted. */
  count: number;
  /** No draft waits and the ticked summary comment does: the button reads "Publish summary". */
  summaryOnly: boolean;
  /** Nothing ticked waits and something went out: the button reads "Published". */
  done: boolean;
  /** The call runs: the button shows a spinner and the list is locked. */
  pending: boolean;
  /** What the last Publish or Retry sent; null before the first one and while one runs. */
  outcome: PublishOutcome | null;
  /** The last call failed as a whole (nothing was sent). */
  error: IpcError | null;
  /** Draft comments in GitLab's own review (decision 8); 0 when none or unknown. */
  foreign: number;
  /** A failed row, or the failed summary comment, is still ticked, so Retry has something to send. */
  canRetry: boolean;
  publish: () => void;
  retry: () => void;
}

const waiting = (draft: Draft) => draft.include && draft.publishedNoteId === null;

/** Whether the session's summary comment went out (kept by the core, F-12.5). */
const sentKey = (sessionId: string) => ['summary', 'published', sessionId] as const;

/**
 * Publish (N) and Retry of S-05 (F-12.5, M5 decisions 7, 8 and 9). Publish sends the ticked drafts
 * in the list's order and the summary comment when it is ticked with text and hasn't gone out yet;
 * with only the summary waiting it is "Publish summary". Retry sends the rows of the last failure
 * that are still ticked, and the summary when it failed and is still ticked. Whether the summary
 * went out is kept by the core, so it isn't sent twice after a restart either.
 * `live` is false on a restored start: no GitLab count then (F-30.4).
 */
export function usePublishFlow(
  sessionId: string,
  drafts: Draft[] | undefined,
  field: SummaryField | undefined,
  live: boolean,
): PublishFlow {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const foreign = useForeignDrafts(sessionId, live);
  const mutation = useDraftsPublish(sessionId);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const summarySent =
    useQuery({
      queryKey: sentKey(sessionId),
      queryFn: async () => (await ipc.sessionSummary(sessionId)).published === true,
      enabled: sessionId !== '',
      staleTime: Infinity,
    }).data === true;

  const list = drafts ?? [];
  const count = list.filter(waiting).length;
  const summaryWaiting = field?.enabled === true && field.text.trim() !== '' && !summarySent;
  const failed = new Set(outcome?.failed.map((f) => f.id) ?? []);
  const retryIds = list.filter((d) => waiting(d) && failed.has(d.id)).map((d) => d.id);
  const retrySummary = outcome?.summaryFailed !== undefined && summaryWaiting;

  const send = (ids: string[]) => {
    if (mutation.isPending) return;
    setOutcome(null);
    mutation.mutate(
      {
        ids,
        summary: summaryWaiting ? field.text : null,
        seenForeign: live ? (foreign.data ?? 0) : null,
      },
      {
        onSuccess: (result) => {
          if (result.kind === 'held') return;
          if (result.outcome.summary) queryClient.setQueryData(sentKey(sessionId), true);
          setOutcome(result.outcome);
        },
      },
    );
  };

  return {
    count,
    summaryOnly: count === 0 && summaryWaiting,
    done:
      count === 0 &&
      !summaryWaiting &&
      (summarySent || list.some((d) => d.publishedNoteId !== null)),
    pending: mutation.isPending,
    outcome: mutation.isPending ? null : outcome,
    error: mutation.error,
    foreign: foreign.data ?? 0,
    canRetry: retryIds.length > 0 || retrySummary,
    publish: () => {
      if (count > 0 || summaryWaiting) send(list.filter(waiting).map((d) => d.id));
    },
    retry: () => {
      if (retryIds.length > 0 || retrySummary) send(retryIds);
    },
  };
}
