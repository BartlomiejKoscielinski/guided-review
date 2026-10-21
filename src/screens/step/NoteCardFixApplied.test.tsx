import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import { useFocusStore } from '../../state/focus';
import { APPLIED, manualAccept } from '../../test/fixAccept';
import { VM_NAME, manualFix, proposalOf } from '../../test/fixProposal';
import { renderApp } from '../../test/renderApp';

// F-25.4 on S-03 in layout A, where only the focused note has its card: the applied line does
// not block the next fix; a new run on the same note replaces it with the busy line.

const PENDING = 'PendingCount won’t refresh after upload';
const BUSY = `Claude is editing ${VM_NAME}…`;

async function fixItem() {
  const note = await screen.findByRole('article', { name: `Claude note: ${PENDING}` });
  await userEvent.click(within(note).getByRole('button', { name: 'More' }));
  const menu = screen.getByRole('menu', { name: /More for PendingCount/ });
  return within(menu).getByRole('menuitem', { name: 'Fix with Claude' });
}

/** S-03 step 4 of the staged self-review with the PendingCount fix accepted. */
async function appliedOnScreen() {
  const run = manualFix();
  const accept = manualAccept();
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
  const app = renderApp(
    { screen: 'S-03', sessionId },
    { ...ipc, fixPropose: run.fixPropose, fixAccept: accept.fixAccept },
  );
  await app.router.navigate(`/session/${sessionId}/step?step=s4`);
  await userEvent.click(await fixItem());
  await screen.findByText(BUSY);
  await act(() => run.finish(proposalOf()));
  await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
  await act(() => accept.succeed());
  await screen.findByText(APPLIED);
  return { ...app, run, sessionId };
}

describe('S-03 note card after Accept (F-25.4)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-25.4 the applied line leaves Fix with Claude enabled, and a new run replaces it', async () => {
    const { run } = await appliedOnScreen();

    const item = await fixItem();
    expect(item).toBeEnabled();
    await userEvent.click(item);
    expect(await screen.findByText(BUSY)).toBeInTheDocument();
    expect(run.fixPropose).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(APPLIED)).toBeNull();
  });

  it('F-25.4 a successful Accept is announced as a status and focus moves to Browse and commit', async () => {
    await appliedOnScreen();
    const status = screen.getByRole('status');
    expect(within(status).getByText(APPLIED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse and commit' })).toHaveFocus();
  });

  it('F-25.4 coming back to a step with an applied line does not move focus to it', async () => {
    const { router, sessionId } = await appliedOnScreen();
    await act(() => router.navigate(`/session/${sessionId}/step?step=s3`));
    await act(() => router.navigate(`/session/${sessionId}/step?step=s4`));
    const browse = await screen.findByRole('button', { name: 'Browse and commit' });
    expect(browse).not.toHaveFocus();
  });
});
