import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { MOCK_REVIEWED_HEAD } from '../../ipc/mock/threadCheck';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-14.2: Approve MR / Revoke approval in the Approval tile of S-05 (SummaryDesk.dc.html, M5
// decisions 10a and 14).
//   not approved by the user -> a button "Approve MR"; a click calls gitlabApprove(session, sha)
//     with the head SHA the user reviewed (summaryStatus.reviewedHead), then the tile reads
//     "Approved by you" / "Approvals: 1 of 1" with a button "Revoke approval" instead of Approve.
//   approved                 -> "Revoke approval" calls gitlabUnapprove(session); the tile is
//     "Not approved yet" with Approve MR again. No confirmation dialog (Revoke undoes it).
//   the MR changed since the review (summaryStatus.changed, or GitLab's conflict on approve):
//     the banner "The MR has a new version since your review." with a "See what changed" button
//     to S-09; Approve MR is disabled; Revoke approval stays usable.
//   Approve is disabled, never hidden, while the status loads or failed (nothing proves the heads
//   match), while approving (no double click), when GitLab doesn't let the user approve
//   ("GitLab doesn't let you approve this MR.") and when it asks for a password ("This project asks
//   for your password to approve. Approve it in GitLab."). Other errors show under the button as
//   role alert and change nothing. No key approves: Enter on S-05 is not bound to it.
//
// Locators the screen keeps: the buttons by name inside the aside "Approval"; the banner as a text
// element with the exact copy anywhere on the screen; the errors as role alert in the aside.

const MR_SESSION = 'mock-mr-session-1';
const BANNER = 'The MR has a new version since your review.';
const NOT_ALLOWED = "GitLab doesn't let you approve this MR.";
const PASSWORD = 'This project asks for your password to approve. Approve it in GitLab.';

const ME = { username: 'bartek.k', name: 'Bartek K.' };
const APPROVED = { gitlab: { approval: { approvedBy: [ME], userHasApproved: true } } };
const conflict = () =>
  new IpcError({ code: 'CONFLICT', message: 'GitLab reports a conflict.', retryable: false });

async function backend(
  override: Partial<IpcClient> = {},
  options: Parameters<typeof createMockClient>[0] = {},
) {
  const base = createMockClient({ latencyMs: 0, ...options });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  return recordingClient({ ...base, ...override });
}

async function openSummary(
  override: Partial<IpcClient> = {},
  options: Parameters<typeof createMockClient>[0] = {},
) {
  const rec = await backend(override, options);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  await screen.findByRole('tablist', { name: 'Comments' });
  return { ...app, ...rec };
}

const tile = () => screen.findByRole('complementary', { name: 'Approval' });
const approveButton = async () => within(await tile()).findByRole('button', { name: 'Approve MR' });
const revokeButton = async () =>
  within(await tile()).findByRole('button', { name: 'Revoke approval' });

/** The Approve MR button once the head comparison has answered and it can be clicked. */
async function enabledApprove() {
  const button = await approveButton();
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  return button;
}

describe('S-05 Approve MR and Revoke approval (F-14.2)', () => {
  it('F-14.2 a click on Approve MR sends the reviewed head of the session, once', async () => {
    const approve = vi.fn((_session: string, _sha: string) => Promise.resolve());
    await openSummary({ gitlabApprove: approve });

    await userEvent.click(await enabledApprove());

    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(MR_SESSION, MOCK_REVIEWED_HEAD);
  });

  it('F-14.2 after approving: "Approved by you", "Approvals: 1 of 1", Revoke approval instead of Approve MR', async () => {
    await openSummary();

    await userEvent.click(await enabledApprove());

    const aside = await tile();
    expect(await within(aside).findByText('Approved by you')).toBeInTheDocument();
    expect(within(aside).getByText('Approvals: 1 of 1')).toBeInTheDocument();
    expect(within(aside).getByRole('button', { name: 'Revoke approval' })).toBeEnabled();
    expect(within(aside).queryByRole('button', { name: 'Approve MR' })).toBeNull();
  });

  it('F-14.2 Revoke approval calls gitlabUnapprove, asks nothing, and the tile reads "Not approved yet" again', async () => {
    const { calls } = await openSummary({}, APPROVED);

    await userEvent.click(await revokeButton());

    const aside = await tile();
    expect(await within(aside).findByText('Not approved yet')).toBeInTheDocument();
    expect(within(aside).getByText('Approvals: 0 of 1')).toBeInTheDocument();
    expect(within(aside).getByRole('button', { name: 'Approve MR' })).toBeInTheDocument();
    expect(within(aside).queryByRole('button', { name: 'Revoke approval' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls).toContain('gitlabUnapprove');
  });

  it('F-14.2 while the approval is in flight Approve MR is disabled, so a second click sends nothing', async () => {
    let release: () => void = () => undefined;
    const approve = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await openSummary({ gitlabApprove: approve });
    const button = await enabledApprove();

    await userEvent.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    await userEvent.click(button);

    expect(approve).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it('F-14.2 the MR changed since the review: the banner, a See what changed button and Approve MR disabled', async () => {
    await openSummary({}, { gitlab: { mrChanged: true } });

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See what changed' })).toBeInTheDocument();
    expect(await approveButton()).toBeDisabled();
  });

  it('F-14.2 See what changed opens S-09 of the session', async () => {
    const app = await openSummary({}, { gitlab: { mrChanged: true } });

    await userEvent.click(await screen.findByRole('button', { name: 'See what changed' }));

    expect(app.router.state.location.pathname).toBe(
      pathFor({ screen: 'S-09', sessionId: MR_SESSION }),
    );
  });

  it('F-14.2 an unchanged MR shows no banner', async () => {
    await openSummary();
    await enabledApprove();

    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.queryByRole('button', { name: 'See what changed' })).toBeNull();
  });

  it('F-14.2 GitLab answers the approval with a conflict (the MR changed meanwhile): the banner appears and Approve MR is disabled', async () => {
    const approve = vi.fn(() => Promise.reject(conflict()));
    await openSummary({ gitlabApprove: approve });
    const button = await enabledApprove();

    await userEvent.click(button);

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See what changed' })).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(within(await tile()).getByText('Not approved yet')).toBeInTheDocument();
  });

  it('F-14.2 Revoke approval stays usable when the MR changed', async () => {
    await openSummary({}, { gitlab: { mrChanged: true, ...APPROVED.gitlab } });

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(await revokeButton()).toBeEnabled();
  });

  it('F-14.2 Approve MR is disabled until the head comparison has answered', async () => {
    const status = vi.fn(() => new Promise<never>(() => undefined));
    await openSummary({ summaryStatus: status });

    expect(await approveButton()).toBeDisabled();
  });

  it('F-14.2 when the comparison fails Approve MR stays disabled: nothing proves the reviewed head is still the MR head', async () => {
    const status = vi.fn(() =>
      Promise.reject(
        new IpcError({ code: 'GITLAB_UNREACHABLE', message: 'GitLab is down.', retryable: true }),
      ),
    );
    const approve = vi.fn(() => Promise.resolve());
    await openSummary({ summaryStatus: status, gitlabApprove: approve });

    const button = await approveButton();
    await waitFor(() => {
      expect(status).toHaveBeenCalled();
    });
    await userEvent.click(button);

    expect(button).toBeDisabled();
    expect(approve).not.toHaveBeenCalled();
  });

  it('F-14.2 a failed approval shows its message under the button as an alert and changes nothing', async () => {
    const approve = vi.fn(() =>
      Promise.reject(
        new IpcError({
          code: 'GITLAB_UNREACHABLE',
          message: 'GitLab had a server error.',
          retryable: true,
        }),
      ),
    );
    await openSummary({ gitlabApprove: approve });
    const button = await enabledApprove();

    await userEvent.click(button);

    const aside = await tile();
    expect(await within(aside).findByRole('alert')).toHaveTextContent('GitLab had a server error.');
    expect(within(aside).getByText('Not approved yet')).toBeInTheDocument();
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(button).toBeEnabled();
  });

  it('F-14.2 a failed Revoke shows its message as an alert and the tile stays approved', async () => {
    const unapprove = vi.fn(() =>
      Promise.reject(
        new IpcError({
          code: 'GITLAB_NOT_FOUND',
          message: "GitLab didn't find it.",
          retryable: false,
        }),
      ),
    );
    await openSummary({ gitlabUnapprove: unapprove }, APPROVED);

    await userEvent.click(await revokeButton());

    const aside = await tile();
    expect(await within(aside).findByRole('alert')).toHaveTextContent("GitLab didn't find it.");
    expect(within(aside).getByText('Approved by you')).toBeInTheDocument();
  });

  it('F-14.2 when GitLab does not let the user approve: Approve MR is disabled with the reason', async () => {
    await openSummary({}, { gitlab: { approval: { userCanApprove: false } } });

    expect(await within(await tile()).findByText(NOT_ALLOWED)).toBeInTheDocument();
    expect(await approveButton()).toBeDisabled();
  });

  it('F-14.2 when the project asks for a password: Approve MR is disabled and the app never handles it', async () => {
    await openSummary({}, { gitlab: { approval: { requirePasswordToApprove: true } } });

    const aside = await tile();
    expect(await within(aside).findByText(PASSWORD)).toBeInTheDocument();
    expect(await approveButton()).toBeDisabled();
    expect(within(aside).queryByLabelText(/password/i)).toBeNull();
  });

  it('F-14.2 no key approves: Enter on the summary sends nothing, and Approve MR is not focused on open', async () => {
    const approve = vi.fn(() => Promise.resolve());
    await openSummary({ gitlabApprove: approve });
    const button = await enabledApprove();
    expect(button).not.toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    expect(approve).not.toHaveBeenCalled();
  });

  it('F-14.2 a restored start reads nothing from GitLab: no head comparison, no approval sent, Approve MR not enabled', async () => {
    const rec = await backend();
    const app = renderApp({ screen: 'S-01' }, rec.client);
    await act(() =>
      app.router.navigate(`/session/${MR_SESSION}/summary`, { state: { restored: true } }),
    );
    await screen.findByRole('tablist', { name: 'Comments' });

    const aside = await tile();
    expect(rec.calls).not.toContain('summaryStatus');
    expect(rec.calls).not.toContain('gitlabApprove');
    const approve = within(aside).queryByRole('button', { name: 'Approve MR' });
    if (approve) expect(approve).toBeDisabled();
  });
});
