import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-12.7 (docs/plans/M5.md, decision 15): S-05 of a "drafts only" session, the one a draft made
// outside a review (Explain failure on S-08, Add as a question on S-12) creates when its MR has no
// session. It is the MR summary (the Drafts list with Publish) of a session that has no steps: no
// progress line and no Back to steps, whether the screen is opened from a card or restored on
// start, and also after the drafts are published. A draft that joined a review session shows in
// that session's S-05, which keeps its progress line and Back to steps.
//
// Locators the screen keeps: the heading "Summary", the tab list "Comments" with the tab names
// starting "Drafts" and "Threads", the Drafts panel as role tabpanel with one list item per draft,
// the button "Publish (N)" / "Published" outside the panel, the banner as role status.

const PROJECT = 'mobile/mobile-app';
const BODY = 'Is the keystore secret set for this branch?';
/** Commands that may run Claude or call GitLab; a restored S-05 calls none of them (F-30.4). */
const WORK = /^(review|gitlab|claude(?!Status$|Models$))/;

const question = (body: string) => ({ body, position: null, severity: 'q' as const });
const ignore = () => undefined;

/** An MR with no session of its own that got a draft from outside a review. */
async function draftsOnly() {
  const ipc = createMockClient({ latencyMs: 0 });
  const draft = await ipc.draftsCreateForMr(PROJECT, 482, question(BODY));
  return { ipc, draft };
}

const summaryHeading = () => screen.findByRole('heading', { name: /^summary$/i });
const panel = () => screen.getByRole('tabpanel');
const noProgressLine = () => {
  expect(screen.queryByText(/steps? reviewed\.$/)).toBeNull();
  expect(screen.queryByText(/^\d+ of \d+ steps/)).toBeNull();
};

describe('S-05 of a drafts-only session (F-12.7)', () => {
  it('F-12.7 shows SUMMARY and the draft with Publish (1), no progress line and no Back to steps', async () => {
    const { ipc, draft } = await draftsOnly();
    const app = renderApp({ screen: 'S-01' }, ipc);

    await act(() => app.router.navigate(`/session/${draft.sessionId}/summary`));

    expect(await summaryHeading()).toBeInTheDocument();
    expect(await within(await screen.findByRole('tabpanel')).findByText(BODY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish (1)' })).toBeEnabled();
    noProgressLine();
    expect(screen.queryByRole('button', { name: 'Back to steps' })).toBeNull();
  });

  it('F-12.7 is the MR summary with its Drafts and Threads tabs, never the self-review summary', async () => {
    // The core answers "no MR" (null) for a session without prepared MR fields, which is also how
    // a self-review looks; the drafts-only session is an MR session all the same.
    const { ipc, draft } = await draftsOnly();
    const app = renderApp({ screen: 'S-01' }, ipc);

    await act(() => app.router.navigate(`/session/${draft.sessionId}/summary`));

    expect(await summaryHeading()).toBeInTheDocument();
    const tabs = await screen.findByRole('tablist', { name: 'Comments' });
    expect(within(tabs).getByRole('tab', { name: /^Drafts/ })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /^Threads/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy as checklist/i })).toBeNull();
    expect(screen.queryByText('Nothing to fix.')).toBeNull();
  });

  it('F-12.7 restored on start it shows the same summary and starts no Claude or GitLab work', async () => {
    const { ipc, draft } = await draftsOnly();
    const { client, calls } = recordingClient(ipc);

    const { router } = renderApp({ screen: 'S-05', sessionId: draft.sessionId }, client);

    expect(router.state.location.state).toEqual({ restored: true });
    expect(await summaryHeading()).toBeInTheDocument();
    expect(await within(await screen.findByRole('tabpanel')).findByText(BODY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish (1)' })).toBeInTheDocument();
    noProgressLine();
    expect(screen.queryByRole('button', { name: 'Back to steps' })).toBeNull();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });

  it('F-12.7 Publish sends the draft, and the published summary still has no Back to steps', async () => {
    const user = userEvent.setup();
    const { ipc, draft } = await draftsOnly();
    const app = renderApp({ screen: 'S-01' }, ipc);
    await act(() => app.router.navigate(`/session/${draft.sessionId}/summary`));
    await user.click(await screen.findByRole('button', { name: 'Publish (1)' }));

    expect(
      await screen.findByText('Published 1 comment. The author got a single notification.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Published' })).toBeDisabled();
    expect(within(panel()).getByText(/· published/)).toBeInTheDocument();
    noProgressLine();
    expect(screen.queryByRole('button', { name: 'Back to steps' })).toBeNull();
  });

  it('F-12.7 a draft that joined a review session shows in its S-05, which keeps the progress line and Back to steps', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    const { sessionId } = await ipc.sessionOpenMr(482, null, 'task', ignore);
    await ipc.reviewPlan(sessionId, ignore);
    const source = await ipc.sessionSource(sessionId);
    if (source.kind !== 'mr') throw new Error('not an MR session');

    const draft = await ipc.draftsCreateForMr(source.project, 482, question(BODY));
    expect(draft.sessionId).toBe(sessionId);
    renderApp({ screen: 'S-05', sessionId }, ipc);

    expect(await summaryHeading()).toBeInTheDocument();
    expect(await within(await screen.findByRole('tabpanel')).findByText(BODY)).toBeInTheDocument();
    expect(await screen.findByText('0 of 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to steps' })).toBeInTheDocument();
  });
});
