import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { IpcError } from '../errors';
import { MOCK_REVIEWED_HEAD } from './threadCheck';

// F-14.2 in the mock backend, as the core answers (plan M5, row F-14.2):
//   summaryStatus(session)        -> { reviewedHead, currentHead, changed }; `changed` is true when
//                                    the MR's head (gitlab/mr.rs::get) differs from the reviewed
//                                    head. The mock reviews MOCK_REVIEWED_HEAD; the scenario knob
//                                    `mrChanged` (GitlabScenario, MOCK_GITLAB_KEY) makes the MR
//                                    move on to another head.
//   gitlabApprove(session, sha)   -> refuses (CONFLICT) a sha other than the reviewed head, and any
//                                    sha when the MR changed (GitLab's 409); otherwise the user
//                                    has approved: gitlabApprovalState reads userHasApproved and
//                                    the user among approvedBy.
//   gitlabUnapprove(session)      -> the user's approval is gone again.
// The guards are the core's, in order: a session without an MR, then no GitLab account.

const SESSION = 'mock-mr-session-1';
const ME = { username: 'bartek.k', name: 'Bartek K.' };
const ALICE = { username: 'alice', name: 'Alice Stand-in' };

async function backend(options: Parameters<typeof createMockClient>[0] = {}) {
  const mock = createMockClient({ latencyMs: 0, ...options });
  await mock.repoPick();
  return mock;
}

async function rejection(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IpcError) return error;
    throw error;
  }
  throw new Error('expected the call to reject');
}

describe('mock approve and revoke (F-14.2)', () => {
  it('F-14.2 summaryStatus: the MR still has the reviewed head, nothing changed', async () => {
    const mock = await backend();
    const status = await mock.summaryStatus(SESSION);
    expect(status.reviewedHead).toBe(MOCK_REVIEWED_HEAD);
    expect(status.currentHead).toBe(MOCK_REVIEWED_HEAD);
    expect(status.changed).toBe(false);
  });

  it('F-14.2 summaryStatus: with the mrChanged scenario the MR moved to another head', async () => {
    const mock = await backend({ gitlab: { mrChanged: true } });
    const status = await mock.summaryStatus(SESSION);
    expect(status.reviewedHead).toBe(MOCK_REVIEWED_HEAD);
    expect(status.currentHead).not.toBe(MOCK_REVIEWED_HEAD);
    expect(status.changed).toBe(true);
  });

  it('F-14.2 approving the reviewed head: the user has approved, "Approvals: 1 of 1"', async () => {
    const mock = await backend();
    await mock.gitlabApprove(SESSION, MOCK_REVIEWED_HEAD);
    await expect(mock.gitlabApprovalState(SESSION)).resolves.toMatchObject({
      approvedBy: [ME],
      approvalsRequired: 1,
      userHasApproved: true,
    });
  });

  it('F-14.2 approving keeps the colleagues who approved before', async () => {
    const mock = await backend({ gitlab: { approval: { approvedBy: [ALICE] } } });
    await mock.gitlabApprove(SESSION, MOCK_REVIEWED_HEAD);
    const state = await mock.gitlabApprovalState(SESSION);
    expect(state.approvedBy).toEqual([ALICE, ME]);
  });

  it('F-14.2 Revoke undoes the approval and leaves the colleagues', async () => {
    const mock = await backend({ gitlab: { approval: { approvedBy: [ALICE] } } });
    await mock.gitlabApprove(SESSION, MOCK_REVIEWED_HEAD);
    await mock.gitlabUnapprove(SESSION);
    await expect(mock.gitlabApprovalState(SESSION)).resolves.toMatchObject({
      approvedBy: [ALICE],
      userHasApproved: false,
    });
  });

  it('F-14.2 a sha other than the reviewed head is refused with CONFLICT and approves nothing', async () => {
    const mock = await backend();
    const error = await rejection(mock.gitlabApprove(SESSION, 'a91f2c0'));
    expect(error.code).toBe('CONFLICT');
    await expect(mock.gitlabApprovalState(SESSION)).resolves.toMatchObject({
      userHasApproved: false,
    });
  });

  it('F-14.2 when the MR changed, GitLab answers the reviewed head with a conflict too', async () => {
    const mock = await backend({ gitlab: { mrChanged: true } });
    const error = await rejection(mock.gitlabApprove(SESSION, MOCK_REVIEWED_HEAD));
    expect(error.code).toBe('CONFLICT');
    await expect(mock.gitlabApprovalState(SESSION)).resolves.toMatchObject({
      userHasApproved: false,
    });
  });

  it('F-14.2 a session without an MR is INVALID_INPUT, without a token GITLAB_UNAUTHORIZED, as the core says', async () => {
    const mock = await backend();
    const { sessionId } = await mock.sessionOpenCommit({ to: 'a3f9c12' });
    expect((await rejection(mock.gitlabApprove(sessionId, MOCK_REVIEWED_HEAD))).code).toBe(
      'INVALID_INPUT',
    );
    expect((await rejection(mock.gitlabUnapprove(sessionId))).code).toBe('INVALID_INPUT');

    const noToken = await backend({ gitlab: { state: 'noToken' } });
    const approve = await rejection(noToken.gitlabApprove(SESSION, MOCK_REVIEWED_HEAD));
    const revoke = await rejection(noToken.gitlabUnapprove(SESSION));
    expect(approve.code).toBe('GITLAB_UNAUTHORIZED');
    expect(revoke.code).toBe('GITLAB_UNAUTHORIZED');
  });
});
