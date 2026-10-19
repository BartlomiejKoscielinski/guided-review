import { useId } from 'react';
import { CheckIcon } from '../../components/icons';
import { cx } from '../../components/cx';
import { useApprovalState } from '../../ipc/hooks/useApprovalState';
import { approvalCount } from './approvalCopy';
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
 * can't. Approve and Revoke come with F-14.2, the notes with F-14.3.
 */
export function ApprovalTile({ sessionId, restored }: ApprovalTileProps) {
  const headingId = useId();
  const approval = useApprovalState(sessionId, !restored);
  const state = approval.data;
  const approved = state?.userHasApproved === true;

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
        )
      )}
    </aside>
  );
}
