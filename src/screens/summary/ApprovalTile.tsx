import { useId } from 'react';
import { CheckIcon } from '../../components/icons';
import { cx } from '../../components/cx';
import { useApprovalState } from '../../ipc/hooks/useApprovalState';
import { useDiscussions } from '../../ipc/hooks/useDiscussions';
import { useDrafts } from '../../ipc/hooks/useDrafts';
import { ApprovalButtons } from './ApprovalButtons';
import { APPROVE_NOTE, APPROVED_WAITING_NOTE, approvalCount, threadsLine } from './approvalCopy';
import { openThreadCount } from './openingTab';
import styles from './ApprovalTile.module.css';

export interface ApprovalTileProps {
  sessionId: string;
  /** Restored on start (F-30.4): GitLab is not asked, the tile says to open the summary again. */
  restored: boolean;
}

/**
 * S-05's Approval tile (F-14.1, SummaryDesk.dc.html): "Not approved yet" with a dashed square on
 * the dark tile, or "Approved by you" with a checked square on solid green, and "Approvals: X of
 * Y". The state is the user's own approval; nothing is claimed before GitLab answers or when it
 * can't. Under it Approve MR or Revoke approval (F-14.2) and two notes (F-14.3): "Approving doesn't
 * publish comments." (or, approved with a draft still unpublished, that the drafts are waiting) and
 * the open threads, left out while the threads load or can't be read.
 */
export function ApprovalTile({ sessionId, restored }: ApprovalTileProps) {
  const headingId = useId();
  const approval = useApprovalState(sessionId, !restored);
  const state = approval.data;
  const approved = state?.userHasApproved === true;
  // Shared queries with MrSummary (same keys), so the tile follows Publish and Resolve.
  const drafts = useDrafts(sessionId);
  const threads = useDiscussions(sessionId, !restored);
  const waiting = approved && (drafts.data ?? []).some((d) => d.publishedNoteId === null);
  const openThreads = threads.data && !threads.isError ? openThreadCount(threads.data) : null;

  return (
    <aside aria-labelledby={headingId} className={cx(styles.tile, approved && styles.approved)}>
      <h2 id={headingId} className={styles.heading}>
        Approval
      </h2>
      {restored ? (
        <p className={styles.note}>Open the summary again to load the approval.</p>
      ) : approval.isError ? (
        <p role="alert" className={styles.note}>
          {approval.error.message}
        </p>
      ) : (
        state && (
          <>
            <div className={styles.state}>
              <span
                data-testid="approval-mark"
                className={approved ? styles.markApproved : styles.markEmpty}
              >
                {approved && <CheckIcon size={24} strokeWidth={2.6} />}
              </span>
              <div className={styles.text}>
                <span className={styles.title}>
                  {approved ? 'Approved by you' : 'Not approved yet'}
                </span>
                <span className={styles.count}>{approvalCount(state)}</span>
              </div>
            </div>
            <ApprovalButtons sessionId={sessionId} state={state} />
            <div className={styles.notes}>
              <span>{waiting ? APPROVED_WAITING_NOTE : APPROVE_NOTE}</span>
              {openThreads !== null && <span>{threadsLine(openThreads)}</span>}
            </div>
          </>
        )
      )}
    </aside>
  );
}
