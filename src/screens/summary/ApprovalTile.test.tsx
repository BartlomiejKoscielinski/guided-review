import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-14.1: the Approval tile of S-05 (SummaryDesk.dc.html, M5 decision 14). To the right of the
// comments, an aside named "Approval" (role complementary) holds the state and the count:
//   not approved by the user -> "Not approved yet" (shown in capitals), "Approvals: 0 of 1"
//   approved by the user     -> "Approved by you", "Approvals: 1 of 1"
// The state is the user's own (`userHasApproved`); the count is how many people approved
// (`approvedBy`) of how many GitLab asks for (`approvalsRequired`). An MR that asks for none says
// "Approvals: X", never "of 0". The state is read with `gitlabApprovalState(session)` when the
// summary opens (not on a restored start, F-30.4) and nothing is claimed before GitLab answers or
// when it can't: an error is not "not approved yet". The Approve and Revoke buttons are F-14.2's,
// the notes and thread lines of the tile F-14.3's. How the dashed square and the green fill look is
// checked in tests/e2e/summary-f14-1.spec.ts.
//
// Locators the screen keeps: <aside aria-labelledby> named "Approval" holding an h2 "Approval";
// the state and the count as two separate text elements; a failure as role alert in the aside.

const MR_SESSION = 'mock-mr-session-1';
const PROJECT = 'mobile/mobile-app';
/** Commands that may run Claude or call GitLab; a restored S-05 calls none of them (F-30.4). */
const WORK = /^(review|gitlab|claude(?!Status$|Models$|Activity$))/;

const ME = { username: 'bartek.k', name: 'Bartek K.' };
const ALICE = { username: 'alice', name: 'Alice Stand-in' };
const PAWEL = { username: 'pawel.s', name: 'Paweł S.' };

interface Approval {
  approvedBy: { username: string; name: string }[];
  approvalsRequired: number;
  userHasApproved: boolean;
  userCanApprove: boolean;
  requirePasswordToApprove: boolean;
}

/** What GitLab says of an MR nobody approved and one approval asked for (the mock's start). */
const NOBODY: Approval = {
  approvedBy: [],
  approvalsRequired: 1,
  userHasApproved: false,
  userCanApprove: true,
  requirePasswordToApprove: false,
};
const answer = (over: Partial<Approval>): IpcClient['gitlabApprovalState'] =>
  vi.fn(() => Promise.resolve({ ...NOBODY, ...over }));

async function backend(override: Partial<IpcClient> = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  return recordingClient({ ...base, ...override });
}

async function openSummary(override: Partial<IpcClient> = {}) {
  const rec = await backend(override);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  await screen.findByRole('tablist', { name: 'Comments' });
  return { ...app, ...rec };
}

const tile = () => screen.findByRole('complementary', { name: 'Approval' });

describe('S-05 Approval tile (F-14.1)', () => {
  it('F-14.1 an MR nobody approved: "Not approved yet" and "Approvals: 0 of 1" in the Approval tile', async () => {
    await openSummary();

    const aside = await tile();
    expect(within(aside).getByRole('heading', { name: 'Approval' })).toBeInTheDocument();
    expect(await within(aside).findByText('Not approved yet')).toBeInTheDocument();
    expect(within(aside).getByText('Approvals: 0 of 1')).toBeInTheDocument();
    expect(within(aside).queryByText('Approved by you')).toBeNull();
  });

  it('F-14.1 approved by the user: "Approved by you" and "Approvals: 1 of 1", no "Not approved yet"', async () => {
    await openSummary({
      gitlabApprovalState: answer({ approvedBy: [ME], userHasApproved: true }),
    });

    const aside = await tile();
    expect(await within(aside).findByText('Approved by you')).toBeInTheDocument();
    expect(within(aside).getByText('Approvals: 1 of 1')).toBeInTheDocument();
    expect(within(aside).queryByText('Not approved yet')).toBeNull();
  });

  it('F-14.1 another reviewer approved but the user did not: still "Not approved yet", counted as "Approvals: 1 of 2"', async () => {
    await openSummary({
      gitlabApprovalState: answer({ approvedBy: [ALICE], approvalsRequired: 2 }),
    });

    const aside = await tile();
    expect(await within(aside).findByText('Not approved yet')).toBeInTheDocument();
    expect(within(aside).getByText('Approvals: 1 of 2')).toBeInTheDocument();
    expect(within(aside).queryByText('Approved by you')).toBeNull();
  });

  it('F-14.1 the user and a colleague approved an MR that asks for 3: "Approved by you", "Approvals: 2 of 3"', async () => {
    await openSummary({
      gitlabApprovalState: answer({
        approvedBy: [PAWEL, ME],
        approvalsRequired: 3,
        userHasApproved: true,
      }),
    });

    const aside = await tile();
    expect(await within(aside).findByText('Approved by you')).toBeInTheDocument();
    expect(within(aside).getByText('Approvals: 2 of 3')).toBeInTheDocument();
  });

  it('F-14.1 more approvals than asked for are counted as GitLab has them: "Approvals: 3 of 2"', async () => {
    await openSummary({
      gitlabApprovalState: answer({
        approvedBy: [ALICE, PAWEL, ME],
        approvalsRequired: 2,
        userHasApproved: true,
      }),
    });

    expect(await within(await tile()).findByText('Approvals: 3 of 2')).toBeInTheDocument();
  });

  it('F-14.1 an MR that asks for no approval says "Approvals: 0", never "of 0"', async () => {
    await openSummary({ gitlabApprovalState: answer({ approvalsRequired: 0 }) });

    const aside = await tile();
    expect(await within(aside).findByText('Not approved yet')).toBeInTheDocument();
    expect(within(aside).getByText('Approvals: 0')).toBeInTheDocument();
    expect(within(aside).queryByText(/ of 0/)).toBeNull();
  });

  it('F-14.1 an MR that asks for no approval, approved by the user, says "Approved by you" and "Approvals: 1"', async () => {
    await openSummary({
      gitlabApprovalState: answer({
        approvedBy: [ME],
        approvalsRequired: 0,
        userHasApproved: true,
      }),
    });

    const aside = await tile();
    expect(await within(aside).findByText('Approved by you')).toBeInTheDocument();
    expect(within(aside).getByText('Approvals: 1')).toBeInTheDocument();
    expect(within(aside).queryByText(/ of 0/)).toBeNull();
  });

  it('F-14.1 the tile stands on both tabs, and the approval is read once for the session, whatever tab is shown', async () => {
    const user = userEvent.setup();
    const read = answer({});
    await openSummary({ gitlabApprovalState: read });
    const aside = await tile();
    expect(await within(aside).findByText('Approvals: 0 of 1')).toBeInTheDocument();

    for (const name of [/^Drafts/, /^Threads/, /^Drafts/]) {
      await user.click(screen.getByRole('tab', { name }));
      expect(within(await tile()).getByText('Approvals: 0 of 1')).toBeInTheDocument();
    }
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(MR_SESSION);
  });

  it('F-14.1 until GitLab answers the tile claims nothing: no state and no count, then the answer', async () => {
    let release: (value: Approval) => void = () => undefined;
    const waiting = new Promise<Approval>((resolve) => {
      release = resolve;
    });
    const read = vi.fn(() => waiting);
    await openSummary({ gitlabApprovalState: read });
    await waitFor(() => {
      expect(read).toHaveBeenCalled();
    });

    expect(screen.queryByText('Not approved yet')).toBeNull();
    expect(screen.queryByText('Approved by you')).toBeNull();
    expect(screen.queryByText(/^Approvals:/)).toBeNull();

    await act(async () => {
      release({ ...NOBODY, approvedBy: [ME], userHasApproved: true });
      await waiting;
    });
    expect(await screen.findByText('Approved by you')).toBeInTheDocument();
    expect(screen.getByText('Approvals: 1 of 1')).toBeInTheDocument();
  });

  it('F-14.1 when the approval can not be read the tile says why and claims no state, not "Not approved yet"', async () => {
    const failure = new IpcError({
      code: 'GITLAB_UNAUTHORIZED',
      message: 'Add a GitLab token in Settings › GitLab.',
      retryable: false,
    });
    await openSummary({ gitlabApprovalState: () => Promise.reject(failure) });

    const aside = await tile();
    expect(await within(aside).findByRole('alert')).toHaveTextContent(
      'Add a GitLab token in Settings › GitLab.',
    );
    expect(within(aside).queryByText('Not approved yet')).toBeNull();
    expect(within(aside).queryByText('Approved by you')).toBeNull();
    expect(within(aside).queryByText(/^Approvals:/)).toBeNull();
  });

  it('F-14.1 the summary of a drafts-only session (F-12.7) has the tile too, read for its own session', async () => {
    const base = createMockClient({ latencyMs: 0 });
    const draft = await base.draftsCreateForMr(PROJECT, 482, {
      body: 'Is the keystore secret set for this branch?',
      position: null,
      severity: 'q',
    });
    const read = answer({ approvedBy: [ALICE], approvalsRequired: 2 });
    const { client } = recordingClient({ ...base, gitlabApprovalState: read });
    const app = renderApp({ screen: 'S-01' }, client);

    await act(() => app.router.navigate(`/session/${draft.sessionId}/summary`));

    const aside = await tile();
    expect(await within(aside).findByText('Not approved yet')).toBeInTheDocument();
    expect(within(aside).getByText('Approvals: 1 of 2')).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith(draft.sessionId);
  });
});

// F-30.4: restoring the last screen calls no GitLab command, so a restored S-05 does not read the
// approval; like the Threads tab ("Open the summary again to load the threads.") the tile says to
// open the summary again.
describe('S-05 Approval tile restored on start (F-14.1, F-30.4)', () => {
  it('F-14.1 F-30.4 a restored summary does not ask GitLab and says "Open the summary again to load the approval."', async () => {
    const read = answer({});
    const { client, calls } = await backend({ gitlabApprovalState: read });

    const { router } = renderApp({ screen: 'S-05', sessionId: MR_SESSION }, client);

    expect(router.state.location.state).toEqual({ restored: true });
    const aside = await tile();
    expect(
      await within(aside).findByText('Open the summary again to load the approval.'),
    ).toBeInTheDocument();
    expect(within(aside).queryByText('Not approved yet')).toBeNull();
    expect(within(aside).queryByText(/^Approvals:/)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});

// The self-review summary has no Approval tile (F-17.4) and so asks GitLab for no approval.
describe('S-05 self-review summary has no Approval tile (F-14.1)', () => {
  it('F-14.1 a self-review summary shows no Approval tile and reads no approval', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    const { sessionId } = await base.sessionOpenLocal({ kind: 'staged' });
    await base.reviewPlan(sessionId, () => undefined);
    const read = answer({});
    const { client, calls } = recordingClient({ ...base, gitlabApprovalState: read });
    const app = renderApp({ screen: 'S-01' }, client);
    await act(() => app.router.navigate(`/session/${sessionId}/plan`));
    expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();

    await act(() => app.router.navigate(`/session/${sessionId}/summary`));

    expect(await screen.findByRole('heading', { name: /^summary$/i })).toBeInTheDocument();
    expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Approval' })).toBeNull();
    expect(screen.queryByText(/^Approvals:/)).toBeNull();
    expect(calls).not.toContain('gitlabApprovalState');
    expect(read).not.toHaveBeenCalled();
  });
});
