import type { UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../../ipc/errors';
import type { Thread } from '../../ipc/types/Thread';
import { filterThreads, type ThreadFilter } from './threadFilter';
import { ThreadList } from './ThreadList';
import summary from './Summary.module.css';

export interface ThreadsTabProps {
  sessionId: string;
  /** `gitlab_discussions(session)`, read each time the summary opens (F-12.2). */
  threads: UseQueryResult<Thread[], IpcError>;
  /** Restored on start: the threads aren't read (F-30.4). */
  restored: boolean;
  /** A "drafts only" session (F-12.7) has no steps: no thread has Show in code. */
  draftsOnly: boolean;
  filter: ThreadFilter;
}

/**
 * The Threads tab of S-05 of an MR session (F-13.1, SummaryDesk.dc.html): the MR's resolvable
 * threads the filter keeps, oldest first, or "No threads in this view." when it keeps none. A
 * restored summary says to open it again, a failed read shows its message, and nothing stands
 * in the list while GitLab answers. Each row (F-13.2) says who opened it ("You" for the signed-in
 * user), its replies and `file:line`, opens the step it shows in, in the session's mode, and has
 * Resolve or Reopen.
 */
export function ThreadsTab({ sessionId, threads, restored, draftsOnly, filter }: ThreadsTabProps) {
  if (restored) {
    return <p className={summary.empty}>Open the summary again to load the threads.</p>;
  }
  // A failed read again after an earlier answer drops that answer too, as the tab's count does.
  if (threads.error) {
    return (
      <p role="alert" className={summary.draftError}>
        {threads.error.message}
      </p>
    );
  }
  if (!threads.data) return null;
  const shown = filterThreads(threads.data, filter);
  if (shown.length === 0) return <p className={summary.empty}>No threads in this view.</p>;
  return <ThreadList sessionId={sessionId} threads={shown} draftsOnly={draftsOnly} />;
}
