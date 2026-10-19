import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { IpcError } from '../errors';

// F-14.1 in the mock backend, as the core answers `gitlab_approval_state(session)` (plan M5: the
// approvals of the session's MR, read only): `approvedBy` (the people who approved),
// `approvalsRequired`, `userHasApproved`, `userCanApprove`, `requirePasswordToApprove`. The start
// is SummaryDesk.dc.html's: nobody approved, one approval asked for ("Approvals: 0 of 1"), the
// user may approve, no password. The scenario knob `approval` (GitlabScenario, set through
// MOCK_GITLAB_KEY in the browser) replaces any of the five fields, e.g. the mock's approved state
// ("Approved by you", "Approvals: 1 of 1"). The guards are the core's, in the core's order: a
// session without an MR first, then no GitLab account.

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

describe('mock approval state (F-14.1)', () => {
  it('F-14.1 gitlabApprovalState starts as the design mock: nobody approved, one approval asked for, the user may approve', async () => {
    const mock = await backend();
    await expect(mock.gitlabApprovalState(SESSION)).resolves.toEqual({
      approvedBy: [],
      approvalsRequired: 1,
      userHasApproved: false,
      userCanApprove: true,
      requirePasswordToApprove: false,
    });
  });

  it('F-14.1 the approval scenario makes the approved state of the design mock: "Approved by you", "Approvals: 1 of 1"', async () => {
    const mock = await backend({
      gitlab: { approval: { approvedBy: [ME], userHasApproved: true } },
    });
    await expect(mock.gitlabApprovalState(SESSION)).resolves.toEqual({
      approvedBy: [ME],
      approvalsRequired: 1,
      userHasApproved: true,
      userCanApprove: true,
      requirePasswordToApprove: false,
    });
  });

  it('F-14.1 the scenario replaces only the fields it names', async () => {
    const mock = await backend({
      gitlab: {
        approval: {
          approvedBy: [ALICE],
          approvalsRequired: 2,
          userCanApprove: false,
          requirePasswordToApprove: true,
        },
      },
    });
    await expect(mock.gitlabApprovalState(SESSION)).resolves.toEqual({
      approvedBy: [ALICE],
      approvalsRequired: 2,
      userHasApproved: false,
      userCanApprove: false,
      requirePasswordToApprove: true,
    });
  });

  it('F-14.1 an MR that asks for no approval is possible: approvalsRequired 0', async () => {
    const mock = await backend({ gitlab: { approval: { approvalsRequired: 0 } } });
    expect((await mock.gitlabApprovalState(SESSION)).approvalsRequired).toBe(0);
  });

  it('F-14.1 a drafts-only session of the MR (F-12.7) is read like any MR session', async () => {
    const mock = await backend();
    const draft = await mock.draftsCreateForMr('mobile/mobile-app', 482, {
      body: 'Is the keystore secret set for this branch?',
      position: null,
      severity: 'q',
    });
    expect((await mock.gitlabApprovalState(draft.sessionId)).approvalsRequired).toBe(1);
  });

  it('F-14.1 reading the approval changes nothing: two reads answer the same', async () => {
    const mock = await backend();
    const first = await mock.gitlabApprovalState(SESSION);
    expect(await mock.gitlabApprovalState(SESSION)).toEqual(first);
  });

  it('F-14.1 a session without a merge request answers INVALID_INPUT, without a token GITLAB_UNAUTHORIZED', async () => {
    const mock = await backend();
    const { sessionId } = await mock.sessionOpenCommit({ to: 'a3f9c12' });
    expect((await rejection(mock.gitlabApprovalState(sessionId))).code).toBe('INVALID_INPUT');

    const noToken = await backend({ gitlab: { state: 'noToken' } });
    const unauthorized = await rejection(noToken.gitlabApprovalState(SESSION));
    expect(unauthorized.code).toBe('GITLAB_UNAUTHORIZED');

    // The core looks the session up before it asks for the account.
    const { sessionId: local } = await noToken.sessionOpenCommit({ to: 'a3f9c12' });
    expect((await rejection(noToken.gitlabApprovalState(local))).code).toBe('INVALID_INPUT');
  });
});
