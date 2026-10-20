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

describe('S-03 note card after Accept (F-25.4)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-25.4 the applied line leaves Fix with Claude enabled, and a new run replaces it', async () => {
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

    const item = await fixItem();
    expect(item).toBeEnabled();
    await userEvent.click(item);
    expect(await screen.findByText(BUSY)).toBeInTheDocument();
    expect(run.fixPropose).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(APPLIED)).toBeNull();
  });
});
