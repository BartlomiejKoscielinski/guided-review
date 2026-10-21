import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import type { ErrorCode } from '../../ipc/types/ErrorCode';
import { useFocusStore } from '../../state/focus';
import { APPLIED, STALE, manualAccept } from '../../test/fixAccept';
import { VM_NAME, manualFix, proposalOf } from '../../test/fixProposal';
import { renderApp } from '../../test/renderApp';

// F-25.4 on S-03 of a self-review: the proposal card under a note (F-25.3) acts. Accept calls
// `fixAccept(proposal.id)`; while it is in flight Accept and Discard are disabled (no second
// write). On success the card is replaced by the line "Applied to your working copy." with
// Browse and commit (S-06 local mode, M7 decision 2); the line does not block other fixes: the
// next Fix with Claude is enabled and its busy line replaces it. A refused Accept
// (FIX_STALE: "The file changed while Claude worked. Run it again.", or any other error) keeps
// the proposal on screen with the message as an alert, Accept usable again; Discard then drops it.
// Discard calls `fixDiscard(proposal.id)`, closes the card at once and enables Fix with Claude.
// "Claude made no change." has nothing kept in the core, so Close does not call `fixDiscard`.
//
// Locators the screen keeps: the card's texts and buttons of FixCard.test.tsx, the failure as
// role "alert" inside the card, the applied line as plain text "Applied to your working copy."
// and a button named exactly "Browse and commit", the card after the note's article.

const PENDING = 'PendingCount won’t refresh after upload';
const BUSY = `Claude is editing ${VM_NAME}…`;
const WRITE_FAILED = 'The change could not be written.';

const noteOf = (title: string) => screen.findByRole('article', { name: `Claude note: ${title}` });

async function fixItem(title: string) {
  const note = await noteOf(title);
  await userEvent.click(within(note).getByRole('button', { name: 'More' }));
  const head = title.slice(0, 12).replace(/[()]/g, String.raw`\$&`);
  const menu = screen.getByRole('menu', { name: new RegExp(`More for ${head}`) });
  return within(menu).getByRole('menuitem', { name: 'Fix with Claude' });
}

/** S-03 step 4 of the mock's staged self-review with a proposal waiting under the PendingCount note. */
async function proposalOnScreen() {
  const run = manualFix();
  const accept = manualAccept();
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
  const app = renderApp(
    { screen: 'S-03', sessionId },
    {
      ...ipc,
      fixPropose: run.fixPropose,
      claudeCancel: run.claudeCancel,
      fixAccept: accept.fixAccept,
      fixDiscard: accept.fixDiscard,
    },
  );
  await app.router.navigate(`/session/${sessionId}/step?step=s4`);
  expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  await userEvent.click(await fixItem(PENDING));
  await screen.findByText(BUSY);
  await act(() => run.finish(proposalOf()));
  await screen.findByText('Proposed change');
  return { ...app, run, accept };
}

const acceptButton = () => screen.getByRole('button', { name: 'Accept' });
const discardButton = () => screen.getByRole('button', { name: 'Discard' });

describe('S-03 note card: Accept and Discard (F-25.4)', () => {
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
    expect(accept.fixDiscard).not.toHaveBeenCalled();
    expect(acceptButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
    // The proposal stays on screen until the core has answered.
    expect(screen.getByText('Proposed change')).toBeInTheDocument();
    expect(screen.queryByText(APPLIED)).toBeNull();
  });

  it('F-25.4 a successful Accept replaces the proposal with "Applied to your working copy." under the note', async () => {
    const { accept } = await proposalOnScreen();
    await userEvent.click(acceptButton());
    await act(() => accept.succeed());

    const applied = await screen.findByText(APPLIED);
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const note = await noteOf(PENDING);
    expect(note.compareDocumentPosition(applied) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Browse and commit' })).toBeEnabled();
  });

  it('F-25.4 Browse and commit on the applied line opens S-06 in local mode', async () => {
    const { accept, router } = await proposalOnScreen();
    await userEvent.click(acceptButton());
    await act(() => accept.succeed());
    await userEvent.click(await screen.findByRole('button', { name: 'Browse and commit' }));
    expect(router.state.location.pathname).toBe('/changes');
  });

  it('F-25.4 after Accept the next Fix with Claude is enabled, and its run replaces the applied line', async () => {
    const { accept, run } = await proposalOnScreen();
    await userEvent.click(acceptButton());
    await act(() => accept.succeed());
    await screen.findByText(APPLIED);

    const item = await fixItem(PENDING);
    expect(item).toBeEnabled();
    await userEvent.click(item);
    expect(await screen.findByText(BUSY)).toBeInTheDocument();
    expect(run.fixPropose).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(APPLIED)).toBeNull();
  });

  it.each<[ErrorCode, string]>([
    ['FIX_STALE', STALE],
    ['INTERNAL', WRITE_FAILED],
  ])(
    'F-25.4 a refused Accept (%s) keeps the proposal and shows the message as an alert',
    async (code, message) => {
      const { accept } = await proposalOnScreen();
      await userEvent.click(acceptButton());
      await act(() => accept.fail(code, message));

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText(message)).toBeInTheDocument();
      expect(screen.getByText('Proposed change')).toBeInTheDocument();
      expect(screen.queryByText(APPLIED)).toBeNull();
      expect(acceptButton()).toBeEnabled();
      expect(discardButton()).toBeEnabled();
    },
  );

  it('F-25.4 Accept can be tried again after a refusal: the alert goes while it writes, then Applied shows', async () => {
    const { accept } = await proposalOnScreen();
    await userEvent.click(acceptButton());
    await act(() => accept.fail('INTERNAL', WRITE_FAILED));
    await screen.findByRole('alert');

    await userEvent.click(acceptButton());
    expect(accept.fixAccept).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    await act(() => accept.succeed());
    expect(await screen.findByText(APPLIED)).toBeInTheDocument();
  });

  it('F-25.4 Discard after a stale Accept calls fixDiscard, closes the card with its alert and frees Fix with Claude', async () => {
    const { accept } = await proposalOnScreen();
    await userEvent.click(acceptButton());
    await act(() => accept.fail('FIX_STALE', STALE));
    await screen.findByRole('alert');

    await userEvent.click(discardButton());
    expect(accept.fixDiscard).toHaveBeenCalledTimes(1);
    expect(accept.fixDiscard).toHaveBeenCalledWith('fix-1');
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await fixItem(PENDING)).toBeEnabled();
  });

  it('F-25.4 Discard calls fixDiscard with the proposal id, closes the card and never accepts', async () => {
    const { accept } = await proposalOnScreen();
    await userEvent.click(discardButton());

    expect(accept.fixDiscard).toHaveBeenCalledTimes(1);
    expect(accept.fixDiscard).toHaveBeenCalledWith('fix-1');
    expect(accept.fixAccept).not.toHaveBeenCalled();
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(screen.queryByText(APPLIED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await fixItem(PENDING)).toBeEnabled();
  });

  it('F-25.4 Discard closes the card at once, without waiting for the core', async () => {
    const { accept } = await proposalOnScreen();
    accept.fixDiscard.mockReturnValue(new Promise<void>(() => undefined));
    await userEvent.click(discardButton());
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(await fixItem(PENDING)).toBeEnabled();
  });

  it('F-25.4 Close on "Claude made no change." drops nothing in the core: no fixDiscard, no fixAccept', async () => {
    const run = manualFix();
    const accept = manualAccept();
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
    const app = renderApp(
      { screen: 'S-03', sessionId },
      {
        ...ipc,
        fixPropose: run.fixPropose,
        fixAccept: accept.fixAccept,
        fixDiscard: accept.fixDiscard,
      },
    );
    await app.router.navigate(`/session/${sessionId}/step?step=s4`);
    await userEvent.click(await fixItem(PENDING));
    await screen.findByText(BUSY);
    await act(() => run.finish({ ...proposalOf(), hunks: [] }));
    await screen.findByText('Claude made no change.');
    // The title bar has its own Close caption button, earlier in the document.
    const close = screen.getAllByRole('button', { name: 'Close' }).at(-1);
    if (!close) throw new Error('The card has no Close button.');
    await userEvent.click(close);
    expect(screen.queryByText('Claude made no change.')).toBeNull();
    expect(accept.fixDiscard).not.toHaveBeenCalled();
    expect(accept.fixAccept).not.toHaveBeenCalled();
  });
});
