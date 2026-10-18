import type { UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../../ipc/errors';
import type { Thread } from '../../ipc/types/Thread';
import { filterThreads, type ThreadFilter } from './threadFilter';
import { ThreadRow } from './ThreadRow';
import summary from './Summary.module.css';

export interface ThreadsTabProps {
  /** `gitlab_discussions(session)`, read each time the summary opens (F-12.2). */
  threads: UseQueryResult<Thread[], IpcError>;
  /** Restored on start: the threads aren't read (F-30.4). */
  restored: boolean;
  filter: ThreadFilter;
}

/**
 * The Threads tab of S-05 of an MR session (F-13.1, SummaryDesk.dc.html): the MR's resolvable
 * threads the filter keeps, oldest first, or "No threads in this view." when it keeps none. A
 * restored summary says to open it again, a failed read shows its message, and nothing stands
 * in the list while GitLab answers.
 */
export function ThreadsTab({ threads, restored, filter }: ThreadsTabProps) {
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
  return (
    <ul className={summary.notes}>
      {shown.map((thread) => (
        <ThreadRow key={thread.id} thread={thread} />
      ))}
    </ul>
  );
}
