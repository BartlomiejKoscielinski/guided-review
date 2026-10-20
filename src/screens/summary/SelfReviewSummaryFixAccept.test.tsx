import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import type { NewDraft } from '../../ipc/types/NewDraft';
import { useFocusStore } from '../../state/focus';
import { APPLIED, STALE, manualAccept } from '../../test/fixAccept';
import { VM_NAME, manualFix, proposalOf } from '../../test/fixProposal';
import { renderApp } from '../../test/renderApp';

// F-25.4 on S-05 of a self-review: the proposal card under a note kept to fix (F-25.3) acts.
// Accept calls `fixAccept(proposal.id)`, both buttons are disabled while it is in flight; on
// success the card becomes the line "Applied to your working copy." with Browse and commit
// (S-06 local mode) inside that item (M7 decision 2), and every Fix with Claude is enabled again.
// A refused Accept (FIX_STALE: "The file changed while Claude worked. Run it again.") keeps the
// proposal with the message as an alert; Discard then calls `fixDiscard(proposal.id)` and closes
// the card. The applied line belongs to the note, kept in the store: it survives leaving S-05 and
// coming back.
//
// Locators the screen keeps: each kept note a list item, the applied line and its button named
// exactly "Browse and commit" inside that item (the end of the summary has its own Browse and
// commit, outside the items), the failure as role "alert" inside the item.

const STEP_IDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
const COUNTER = 'Refresh PendingCount after each upload';
const RETRIES = 'Cap the retries in UploadWorker';
const COUNTER_NOTE: NewDraft = {
  sessionId: '',
  findingId: null,
  body: COUNTER,
  position: { file: 'DeliveryPhotoViewModel.cs', side: 'new', line: 49 },
  severity: 'fix',
};
const RETRIES_NOTE: NewDraft = {
  sessionId: '',
  findingId: null,
  body: RETRIES,
  position: { file: 'UploadWorker.cs', side: 'new', line: 71 },
  severity: 'nit',
};
const BUSY = `Claude is editing ${VM_NAME}…`;

async function rowOf(text: string): Promise<HTMLElement> {
  const row = (await screen.findByText(text)).closest('li');
  if (!row) throw new Error(`The note "${text}" is not in a list item.`);
  return row;
}

const fixButton = (row: HTMLElement) =>
  within(row).getByRole('button', { name: 'Fix with Claude' });

/** S-05 of a fully reviewed local self-review, a proposal waiting under the PendingCount note. */
async function proposalOnScreen() {
  const run = manualFix();
  const accept = manualAccept();
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
  await ipc.reviewPlan(sessionId, () => undefined);
  for (const id of STEP_IDS) await ipc.reviewMarkStep(sessionId, id, true);
  for (const note of [COUNTER_NOTE, RETRIES_NOTE]) await ipc.draftsCreate({ ...note, sessionId });
  const app = renderApp(
    { screen: 'S-01' },
    {
      ...ipc,
      fixPropose: run.fixPropose,
      claudeCancel: run.claudeCancel,
      fixAccept: accept.fixAccept,
      fixDiscard: accept.fixDiscard,
    },
  );
  await act(() => app.router.navigate(`/session/${sessionId}/plan`));
  expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
  await act(() => app.router.navigate(`/session/${sessionId}/summary`));
  expect(await screen.findByRole('heading', { name: /^summary$/i })).toBeInTheDocument();
  await userEvent.click(fixButton(await rowOf(COUNTER)));
  await screen.findByText(BUSY);
  await act(() => run.finish(proposalOf()));
  await screen.findByText('Proposed change');
  return { ...app, sessionId, run, accept };
}

const acceptButton = () => screen.getByRole('button', { name: 'Accept' });
const discardButton = () => screen.getByRole('button', { name: 'Discard' });

describe('S-05 self-review summary: Accept and Discard (F-25.4)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-25.4 Accept calls fixAccept with the proposal id and disables both buttons while it writes', async () => {
    const { accept } = await proposalOnScreen();
    await userEvent.click(acceptButton());
    expect(accept.fixAccept).toHaveBeenCalledTimes(1);
    expect(accept.fixAccept).toHaveBeenCalledWith('fix-1');
    expect(acceptButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
    expect(screen.queryByText(APPLIED)).toBeNull();
  });

  it('F-25.4 a successful Accept shows "Applied to your working copy." with Browse and commit inside that item', async () => {
    const { accept, router } = await proposalOnScreen();
    await userEvent.click(acceptButton());
    await act(() => accept.succeed());

    const applied = await screen.findByText(APPLIED);
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    const row = await rowOf(COUNTER);
    expect(row).toContainElement(applied);
    expect(await rowOf(RETRIES)).not.toContainElement(applied);
    // The next fix may start: nothing is waiting any more.
    expect(fixButton(row)).toBeEnabled();
    expect(fixButton(await rowOf(RETRIES))).toBeEnabled();

    await userEvent.click(within(row).getByRole('button', { name: 'Browse and commit' }));
    expect(router.state.location.pathname).toBe('/changes');
  });

  it('F-25.4 the applied line stays when the user leaves S-05 and comes back', async () => {
    const { accept, router, sessionId } = await proposalOnScreen();
    await userEvent.click(acceptButton());
    await act(() => accept.succeed());
    await screen.findByText(APPLIED);

    await act(() => router.navigate(`/session/${sessionId}/plan`));
    expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
    await act(() => router.navigate(`/session/${sessionId}/summary`));
    expect(await screen.findByText(APPLIED)).toBeInTheDocument();
    expect(accept.fixAccept).toHaveBeenCalledTimes(1);
  });

  it('F-25.4 a stale Accept keeps the proposal with the message as an alert; Discard drops it', async () => {
    const { accept } = await proposalOnScreen();
    await userEvent.click(acceptButton());
    await act(() => accept.fail('FIX_STALE', STALE));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(STALE)).toBeInTheDocument();
    expect((await rowOf(COUNTER)).contains(alert)).toBe(true);
    expect(screen.getByText('Proposed change')).toBeInTheDocument();
    expect(screen.queryByText(APPLIED)).toBeNull();
    expect(acceptButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
    // Still one fix at a time while the proposal is on screen.
    expect(fixButton(await rowOf(RETRIES))).toBeDisabled();

    await userEvent.click(discardButton());
    expect(accept.fixDiscard).toHaveBeenCalledTimes(1);
    expect(accept.fixDiscard).toHaveBeenCalledWith('fix-1');
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fixButton(await rowOf(COUNTER))).toBeEnabled();
    expect(fixButton(await rowOf(RETRIES))).toBeEnabled();
  });

  it('F-25.4 Discard calls fixDiscard with the proposal id, closes the card and never accepts', async () => {
    const { accept } = await proposalOnScreen();
    await userEvent.click(discardButton());

    expect(accept.fixDiscard).toHaveBeenCalledTimes(1);
    expect(accept.fixDiscard).toHaveBeenCalledWith('fix-1');
    expect(accept.fixAccept).not.toHaveBeenCalled();
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(screen.queryByText(APPLIED)).toBeNull();
    expect(fixButton(await rowOf(COUNTER))).toBeEnabled();
  });

  it('F-25.4 Discard closes the card at once, without waiting for the core', async () => {
    const { accept } = await proposalOnScreen();
    accept.fixDiscard.mockReturnValue(new Promise<void>(() => undefined));
    await userEvent.click(discardButton());
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(fixButton(await rowOf(COUNTER))).toBeEnabled();
  });
});
