import type { ApprovalState } from '../../ipc/types/ApprovalState';

/** "Approvals: X of Y"; "Approvals: X" when the MR asks for none (M5 decision 14). */
export function approvalCount(state: ApprovalState): string {
  const given = String(state.approvedBy.length);
  return state.approvalsRequired > 0
    ? `Approvals: ${given} of ${String(state.approvalsRequired)}`
    : `Approvals: ${given}`;
}
