import type { UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../../ipc/errors';
import type { Thread } from '../../ipc/types/Thread';
import { ThreadCheckBar } from './ThreadCheckBar';
import { filterThreads, type ThreadFilter } from './threadFilter';
import { ThreadList } from './ThreadList';
import { writtenOnOlderVersion, type ThreadCheck } from './useThreadCheck';
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
  /** Check with Claude (F-13.3), held by the screen so a run outlives a visit to Drafts. */
  check: ThreadCheck;
}

/**
 * The Threads tab of S-05 of an MR session (F-13.1, SummaryDesk.dc.html): the MR's resolvable
 * threads the filter keeps, oldest first, or "No threads in this view." when it keeps none. A
 * restored summary says to open it again, a failed read shows its message, and nothing stands
 * in the list while GitLab answers. Each row (F-13.2) says who opened it ("You" for the signed-in
 * user), its replies and `file:line`, opens the step it shows in, in the session's mode, and has
 * Resolve or Reopen. When an open thread was written on an older version, Check with Claude
 * stands above the rows on every filter (F-13.3, M5 decision 12), and an open thread Claude judges
 * addressed by a later commit shows its hint; a "drafts only" session has no review worktree to
 * read the commits from, so it has no check.
 */
export function ThreadsTab({
  sessionId,
  threads,
  restored,
  draftsOnly,
  filter,
  check,
}: ThreadsTabProps) {
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
  const checkable = !draftsOnly && threads.data.some(writtenOnOlderVersion);
  return (
    <>
      {checkable && <ThreadCheckBar check={check} />}
      {shown.length === 0 ? (
        <p className={summary.empty}>No threads in this view.</p>
      ) : (
        <ThreadList
          sessionId={sessionId}
          threads={shown}
          draftsOnly={draftsOnly}
          hints={check.hints}
        />
      )}
    </>
  );
}
