import type { ApprovalState } from '../../ipc/types/ApprovalState';

/** "Approvals: X of Y"; "Approvals: X" when the MR asks for none (M5 decision 14). */
export function approvalCount(state: ApprovalState): string {
  const given = String(state.approvedBy.length);
  return state.approvalsRequired > 0
    ? `Approvals: ${given} of ${String(state.approvalsRequired)}`
    : `Approvals: ${given}`;
}

/** Why GitLab won't take an approval from the user (M5 decision 14); `null` when it would. */
export function approveBlockedReason(state: ApprovalState): string | null {
  if (state.requirePasswordToApprove) {
    return 'This project asks for your password to approve. Approve it in GitLab.';
  }
  if (!state.userCanApprove) return "GitLab doesn't let you approve this MR.";
  return null;
}

/** The tile's first note (F-14.3, SummaryDesk.dc.html › approveNote). */
export const APPROVE_NOTE = 'Approving doesn’t publish comments.';
/** Once approved while a draft of the session is unpublished, in place of APPROVE_NOTE. */
export const APPROVED_WAITING_NOTE =
  'Approved without comments. Your drafts are waiting, publish them whenever you like.';

/** The tile's threads line (F-14.3, SummaryDesk.dc.html › threadsLine). */
export function threadsLine(open: number): string {
  return open === 0 ? 'All threads resolved.' : `Open threads: ${String(open)}.`;
}
