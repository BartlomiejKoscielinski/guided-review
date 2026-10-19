import { Button } from '../../components/Button';
import { useApprovalActions } from '../../ipc/hooks/useApprovalActions';
import { useSummaryStatus } from '../../ipc/hooks/useSummaryStatus';
import type { ApprovalState } from '../../ipc/types/ApprovalState';
import { approveBlockedReason } from './approvalCopy';
import styles from './ApprovalTile.module.css';

/** Why Approve MR is disabled in a "drafts only" session. */
export const NOTHING_REVIEWED = 'Review the MR to approve it.';

export interface ApprovalButtonsProps {
  sessionId: string;
  state: ApprovalState;
}

/**
 * Approve MR / Revoke approval under the tile's state (F-14.2, SummaryDesk.dc.html). Approve sends
 * the head the user reviewed and is disabled, never hidden, until the head comparison says the MR
 * is still that version, while it is sent, and when GitLab won't take it (M5 decision 14). No key
 * is bound to either; no confirmation (Revoke undoes it). Errors show under the button.
 */
export function ApprovalButtons({ sessionId, state }: ApprovalButtonsProps) {
  const status = useSummaryStatus(sessionId, true);
  const { approve, revoke } = useApprovalActions(sessionId);
  const reviewed = status.data?.reviewedHead ?? '';
  const blocked = approveBlockedReason(state);
  const error = state.userHasApproved
    ? revoke.error
    : approve.error?.code === 'CONFLICT'
      ? null
      : approve.error;

  if (state.userHasApproved) {
    return (
      <>
        <button
          type="button"
          className={styles.revoke}
          disabled={revoke.isPending}
          onClick={() => {
            revoke.mutate(undefined);
          }}
        >
          Revoke approval
        </button>
        {error && (
          <p role="alert" className={styles.note}>
            {error.message}
          </p>
        )}
      </>
    );
  }

  const canApprove =
    status.data !== undefined &&
    !status.data.changed &&
    reviewed !== '' &&
    blocked === null &&
    !approve.isPending;
  return (
    <>
      <Button
        variant="approve"
        size={50}
        disabled={!canApprove}
        onClick={() => {
          if (canApprove) approve.mutate(reviewed);
        }}
      >
        Approve MR
      </Button>
      {blocked && <p className={styles.note}>{blocked}</p>}
      {/* A "drafts only" session (F-12.7) reviewed no version, so it has none to approve. */}
      {blocked === null && status.data?.reviewedHead === '' && (
        <p className={styles.note}>{NOTHING_REVIEWED}</p>
      )}
      {status.isError && (
        <p role="alert" className={styles.note}>
          {status.error.message}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.note}>
          {error.message}
        </p>
      )}
    </>
  );
}
