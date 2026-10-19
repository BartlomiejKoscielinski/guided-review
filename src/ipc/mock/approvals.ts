import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { ApprovalState } from '../types/ApprovalState';
import type { GitlabUser } from '../types/GitlabUser';
import type { MockSessionData } from './session-data';

/** The scenario knob `approval` (MOCK_GITLAB_KEY): replaces any field of the start state. */
export interface ApprovalScenario {
  approval?: Partial<ApprovalState>;
}

/** SummaryDesk.dc.html: nobody approved, one approval asked for ("Approvals: 0 of 1"). */
const START: ApprovalState = {
  approvedBy: [],
  approvalsRequired: 1,
  userHasApproved: false,
  userCanApprove: true,
  requirePasswordToApprove: false,
};

/**
 * `gitlabApprovalState` as `commands/gitlab_threads.rs` answers it (F-14.1): the same guards in
 * the same order (a session without an MR, then no GitLab account); read only. Every MR session of
 * the mock reviews !482, so they share its approval.
 */
export function createApprovalActions(
  store: MockSessionData,
  scenario: ApprovalScenario,
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
): Pick<IpcClient, 'gitlabApprovalState'> {
  const state: ApprovalState = { ...START, ...scenario.approval };
  return {
    gitlabApprovalState: (sessionId) => {
      if (store.data.local.includes(sessionId)) {
        return Promise.reject(
          new IpcError({
            code: 'INVALID_INPUT',
            message: 'The session has no merge request.',
            retryable: false,
          }),
        );
      }
      if (!user()) return Promise.reject(unauthorized());
      return respond({ ...state, approvedBy: state.approvedBy.map((u) => ({ ...u })) });
    },
  };
}
