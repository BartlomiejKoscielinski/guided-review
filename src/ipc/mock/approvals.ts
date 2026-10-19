import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { ApprovalState } from '../types/ApprovalState';
import type { GitlabUser } from '../types/GitlabUser';
import type { SummaryStatus } from '../types/SummaryStatus';
import type { MockSessionData } from './session-data';
import { MOCK_REVIEWED_HEAD } from './threadCheck';

/** The scenario knobs of the approval (MOCK_GITLAB_KEY). */
export interface ApprovalScenario {
  /** Replaces any field of the start state (F-14.1). */
  approval?: Partial<ApprovalState>;
  /** The MR has a new version since the review (F-14.2): its head is no longer the reviewed one. */
  mrChanged?: boolean;
}

/** The MR's head once it moved on (`mrChanged`). */
const NEW_HEAD = 'e5b70d2';

/** SummaryDesk.dc.html: nobody approved, one approval asked for ("Approvals: 0 of 1"). */
const START: ApprovalState = {
  approvedBy: [],
  approvalsRequired: 1,
  userHasApproved: false,
  userCanApprove: true,
  requirePasswordToApprove: false,
};

const noMr = () =>
  new IpcError({
    code: 'INVALID_INPUT',
    message: 'The session has no merge request.',
    retryable: false,
  });

const conflict = (message: string) => new IpcError({ code: 'CONFLICT', message, retryable: false });

/**
 * `gitlabApprovalState` (F-14.1), `summaryStatus`, `gitlabApprove` and `gitlabUnapprove` (F-14.2)
 * as `commands/gitlab_threads.rs` and `commands/approval.rs` answer them: the same guards in the
 * same order (a session without an MR, then no GitLab account, then the reviewed head). Every MR
 * session of the mock reviews !482 at MOCK_REVIEWED_HEAD, so they share its approval; a "drafts
 * only" session reviewed nothing.
 */
export function createApprovalActions(
  store: MockSessionData,
  scenario: ApprovalScenario,
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
): Pick<IpcClient, 'gitlabApprovalState' | 'summaryStatus' | 'gitlabApprove' | 'gitlabUnapprove'> {
  let state: ApprovalState = { ...START, ...scenario.approval };
  const currentHead = scenario.mrChanged === true ? NEW_HEAD : MOCK_REVIEWED_HEAD;
  const reviewedHead = (sessionId: string) =>
    store.data.draftsOnly.includes(sessionId) ? '' : MOCK_REVIEWED_HEAD;
  /** The core's first two guards; `null` when the call may go on. */
  const guard = (sessionId: string): IpcError | null => {
    if (store.data.local.includes(sessionId)) return noMr();
    return user() ? null : unauthorized();
  };
  return {
    gitlabApprovalState: (sessionId) => {
      const refused = guard(sessionId);
      if (refused) return Promise.reject(refused);
      return respond({ ...state, approvedBy: state.approvedBy.map((u) => ({ ...u })) });
    },
    summaryStatus: (sessionId) => {
      const refused = guard(sessionId);
      if (refused) return Promise.reject(refused);
      const reviewed = reviewedHead(sessionId);
      const status: SummaryStatus = {
        reviewedHead: reviewed,
        currentHead,
        changed: reviewed !== '' && currentHead.toLowerCase() !== reviewed.toLowerCase(),
      };
      return respond(status);
    },
    gitlabApprove: (sessionId, sha) => {
      const refused = guard(sessionId);
      if (refused) return Promise.reject(refused);
      const reviewed = reviewedHead(sessionId);
      if (reviewed === '' || sha.toLowerCase() !== reviewed.toLowerCase()) {
        return Promise.reject(conflict('Only the version you reviewed can be approved.'));
      }
      // GitLab's 409: the reviewed head is no longer the MR's head.
      if (currentHead !== reviewed) return Promise.reject(conflict('GitLab reports a conflict.'));
      const me = user();
      if (me && !state.userHasApproved) {
        state = { ...state, userHasApproved: true, approvedBy: [...state.approvedBy, { ...me }] };
      }
      return respond(undefined);
    },
    gitlabUnapprove: (sessionId) => {
      const refused = guard(sessionId);
      if (refused) return Promise.reject(refused);
      // GitLab answers 404 when the user has no approval to take back.
      if (!state.userHasApproved) {
        return Promise.reject(
          new IpcError({
            code: 'GITLAB_NOT_FOUND',
            message: "GitLab didn't find it.",
            retryable: false,
          }),
        );
      }
      const me = user();
      state = {
        ...state,
        userHasApproved: false,
        approvedBy: state.approvedBy.filter((u) => u.username !== me?.username),
      };
      return respond(undefined);
    },
  };
}
