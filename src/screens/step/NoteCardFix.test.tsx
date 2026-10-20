import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import { NOTES_STEP } from '../../ipc/mock/fixtures/review';
import { useFocusStore, type FocusLayout } from '../../state/focus';
import { mockClient, renderWithIpc } from '../../test/render';
import { renderApp } from '../../test/renderApp';
import { StepNotes } from './StepNotes';

// F-25.1: Fix with Claude is offered on own code only. In a self-review the note card's More menu
// has it (M7 decision 1; Keep to fix stays the card's primary action), between Ask Claude and
// Copy; a note card of a teammate's MR never has it. The menu of a self-review note, in order:
// Edit and keep, Ask Claude, Fix with Claude, Copy. Locator the card keeps: a menuitem named
// exactly "Fix with Claude" in the menu "More for <title>". Clicking it starts the fix flow of
// F-25.2 and F-25.3, not tested here.

const SESSION = 'mock-mr-session-1';
const PENDING = 'PendingCount won’t refresh after upload';
const COUNTER = `Claude note: ${PENDING}`;

const menuItems = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.textContent);

describe('NoteCard Fix with Claude (F-25.1)', () => {
  it('F-25.1 a self-review note’s More menu lists Edit and keep, Ask Claude, Fix with Claude, Copy', async () => {
    renderWithIpc(
      <StepNotes sessionId={SESSION} stepId={NOTES_STEP} selfReview onAsk={vi.fn()} />,
      mockClient(),
    );
    const note = await screen.findByRole('article', { name: COUNTER });
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: /More for PendingCount/ });
    expect(menuItems(menu)).toEqual(['Edit and keep', 'Ask Claude', 'Fix with Claude', 'Copy']);
    expect(within(menu).getByRole('menuitem', { name: 'Fix with Claude' })).toBeEnabled();
  });

  it('F-25.1 without a screen that asks Claude the menu is Edit and keep, Fix with Claude, Copy', async () => {
    renderWithIpc(<StepNotes sessionId={SESSION} stepId={NOTES_STEP} selfReview />, mockClient());
    const note = await screen.findByRole('article', { name: COUNTER });
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    expect(menuItems(screen.getByRole('menu', { name: /More for PendingCount/ }))).toEqual([
      'Edit and keep',
      'Fix with Claude',
      'Copy',
    ]);
  });

  it('F-25.1 a note card of a teammate’s MR has no Fix with Claude', async () => {
    renderWithIpc(
      <StepNotes sessionId={SESSION} stepId={NOTES_STEP} onAsk={vi.fn()} />,
      mockClient(),
    );
    const note = await screen.findByRole('article', { name: COUNTER });
    await userEvent.click(within(note).getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: /More for PendingCount/ });
    expect(menuItems(menu)).toEqual(['Edit and add', 'Ask Claude', 'Copy']);
    expect(screen.queryByRole('menuitem', { name: /fix with claude/i })).toBeNull();
  });
});

type Kind = 'local' | 'commit' | 'mr';

/** S-03 on step 4 of a session of the given kind, opened as S-01 opens it, in the given layout. */
async function openStep4(kind: Kind, layout: FocusLayout) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const sessionId =
    kind === 'mr'
      ? SESSION
      : (kind === 'local'
          ? await ipc.sessionOpenLocal({ kind: 'staged' })
          : await ipc.sessionOpenCommit({ to: 'a3f9c12' })
        ).sessionId;
  const app = renderApp({ screen: 'S-03', sessionId }, ipc);
  await app.router.navigate(`/session/${sessionId}/step?step=s4`);
  expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  if (layout !== 'A') {
    act(() => {
      useFocusStore.getState().setLayout(layout);
    });
  }
}

/** The More menu of the note card with this title, wherever the layout puts it. */
async function openMore(title: string) {
  const note = await screen.findByRole('article', { name: `Claude note: ${title}` });
  await userEvent.click(await within(note).findByRole('button', { name: 'More' }));
  return screen.getByRole('menu', { name: new RegExp(`More for ${title.slice(0, 12)}`) });
}

describe('S-03 note cards: Fix with Claude (F-25.1)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it.each<[FocusLayout]>([['A'], ['B'], ['C']])(
    'F-25.1 layout %s: a local self-review note offers Fix with Claude in its More menu',
    async (layout) => {
      await openStep4('local', layout);
      const menu = await openMore(PENDING);
      expect(within(menu).getByRole('menuitem', { name: 'Fix with Claude' })).toBeEnabled();
    },
  );

  it('F-25.1 a session of commits is a self-review too: its note offers Fix with Claude', async () => {
    await openStep4('commit', 'A');
    const menu = await openMore(PENDING);
    expect(within(menu).getByRole('menuitem', { name: 'Fix with Claude' })).toBeInTheDocument();
  });

  it.each<[FocusLayout]>([['A'], ['B'], ['C']])(
    'F-25.1 layout %s: a teammate’s MR note never offers Fix with Claude',
    async (layout) => {
      await openStep4('mr', layout);
      const menu = await openMore(PENDING);
      expect(within(menu).getByRole('menuitem', { name: 'Edit and add' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /fix with claude/i })).toBeNull();
    },
  );
});
