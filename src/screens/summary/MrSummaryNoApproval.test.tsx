import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { GitlabScenario } from '../../ipc/mock/gitlab';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-12.6: Publish on S-05 sends the comments and nothing else. Whatever Publish and Retry do, the
// screen never calls a command that approves or revokes (F-14.2: gitlab_approve, gitlab_unapprove;
// reading the approval, gitlab_approval_state, is not a write and is not matched) and the MR does
// not turn into "Approved by you" (the tile of F-14.1, mock SummaryDesk.dc.html). Publishing only
// changes the drafts: the Approval tile reads as before and Revoke approval stays absent.

const MR_SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const SINGLE_TEXT = 'The author got a single notification.';
/** A command that writes an approval: approve, unapprove (revoke) in any spelling. */
const APPROVAL_WRITE = /approve|revoke/i;

async function backend(gitlab: GitlabScenario = {}): Promise<IpcClient> {
  const base = createMockClient({ latencyMs: 0, gitlab });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  for (const line of [54, 49]) {
    await base.draftsCreate({
      sessionId: MR_SESSION,
      findingId: null,
      severity: 'q',
      body: `Comment on line ${String(line)}.`,
      position: { file: VM, side: 'new', line },
    });
  }
  return { ...base };
}

async function openSummary(client: IpcClient) {
  const app = renderApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  await within(await screen.findByRole('tabpanel')).findAllByRole('listitem');
  return app;
}

function expectNotApproved() {
  expect(screen.queryByText(/approved by you/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /revoke approval/i })).toBeNull();
}

describe('S-05 Publish never approves the MR (F-12.6)', () => {
  it('F-12.6 Publish (2) calls the publish command once, no approve or revoke command, and the MR is not approved afterwards', async () => {
    const { client, calls } = recordingClient(await backend());
    await openSummary(client);
    expectNotApproved();

    await userEvent.click(screen.getByRole('button', { name: 'Publish (2)' }));

    await screen.findByText(`Published 2 comments. ${SINGLE_TEXT}`);
    expect(calls.filter((name) => name === 'draftsPublish')).toHaveLength(1);
    expect(calls.filter((name) => APPROVAL_WRITE.test(name))).toEqual([]);
    expectNotApproved();
  });

  it('F-12.6 a partial failure and its Retry call no approve or revoke command either', async () => {
    const { client, calls } = recordingClient(await backend({ publishFails: [2] }));
    await openSummary(client);

    await userEvent.click(screen.getByRole('button', { name: 'Publish (2)' }));

    const failure = await screen.findByText(/^Published 1 of 2\. 1 failed:/);
    const banner = failure.closest('[role="status"]');
    if (!banner) throw new Error('The failure is not in a status banner.');
    expect(calls.filter((name) => APPROVAL_WRITE.test(name))).toEqual([]);
    expectNotApproved();

    await userEvent.click(within(banner as HTMLElement).getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText(/The author got a single notification\./)).toBeInTheDocument();
    });
    expect(calls.filter((name) => name === 'draftsPublish')).toHaveLength(2);
    expect(calls.filter((name) => APPROVAL_WRITE.test(name))).toEqual([]);
    expectNotApproved();
  });
});
