import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { IpcError } from '../../ipc/errors';
import { useDraftsPublish, useForeignDrafts } from '../../ipc/hooks/usePublish';
import type { Draft } from '../../ipc/types/Draft';
import type { PublishOutcome } from '../../ipc/types/PublishOutcome';
import type { SummaryField } from '../../ipc/types/SummaryField';

export interface PublishFlow {
  /** N of Publish (N): the ticked drafts not published yet; the summary comment isn't counted. */
  count: number;
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
  /** A failed row is still ticked, so Retry has something to send. */
  canRetry: boolean;
  publish: () => void;
  retry: () => void;
}

const waiting = (draft: Draft) => draft.include && draft.publishedNoteId === null;

/**
 * Publish (N) and Retry of S-05 (F-12.5, M5 decisions 8 and 9). Publish sends the ticked drafts
 * in the list's order and the summary comment when it is ticked with text and hasn't gone out yet;
 * Retry sends only the rows of the last failure that are still ticked. Whether the summary went out
 * is kept for the app's run in the query cache, so returning to S-05 doesn't send it twice.
 * `live` is false on a restored start: no GitLab count then (F-30.4).
 */
export function usePublishFlow(
  sessionId: string,
  drafts: Draft[] | undefined,
  field: SummaryField | undefined,
  live: boolean,
): PublishFlow {
  const queryClient = useQueryClient();
  const foreign = useForeignDrafts(sessionId, live);
  const mutation = useDraftsPublish(sessionId);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const sentKey = ['summary', 'published', sessionId] as const;
  const summarySent = useQuery({
    queryKey: sentKey,
    queryFn: () => false,
    initialData: false,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;

  const list = drafts ?? [];
  const count = list.filter(waiting).length;
  const failed = new Set(outcome?.failed.map((f) => f.id) ?? []);
  const retryIds = list.filter((d) => waiting(d) && failed.has(d.id)).map((d) => d.id);

  const send = (ids: string[]) => {
    if (mutation.isPending) return;
    const text = field?.enabled && !summarySent ? field.text : '';
    setOutcome(null);
    mutation.mutate(
      {
        ids,
        summary: text.trim() === '' ? null : text,
        seenForeign: live ? (foreign.data ?? 0) : null,
      },
      {
        onSuccess: (result) => {
          if (result.kind === 'held') return;
          if (result.outcome.summary) queryClient.setQueryData(sentKey, true);
          setOutcome(result.outcome);
        },
      },
    );
  };

  return {
    count,
    done: count === 0 && list.some((d) => d.publishedNoteId !== null),
    pending: mutation.isPending,
    outcome: mutation.isPending ? null : outcome,
    error: mutation.error,
    foreign: foreign.data ?? 0,
    canRetry: retryIds.length > 0,
    publish: () => {
      if (count > 0) send(list.filter(waiting).map((d) => d.id));
    },
    retry: () => {
      if (retryIds.length > 0) send(retryIds);
    },
  };
}
