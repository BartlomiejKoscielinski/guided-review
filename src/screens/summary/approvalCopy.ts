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
