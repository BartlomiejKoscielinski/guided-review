import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

const SESSION = 'mock-mr-session-1';
const SECOND = 'Note 2: PendingCount won’t refresh after upload';

async function openStep4() {
  const app = renderApp({ screen: 'S-03', sessionId: SESSION });
  await app.router.navigate(`/session/${SESSION}/step?step=s4`);
  expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  return app;
}

describe('S-03 layouts B and C', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-07.1 the title bar switches the layout; Ctrl+1/2/3 do the same and the step stays', async () => {
    const { router } = await openStep4();
    const layout = within(screen.getByRole('radiogroup', { name: 'Layout' }));
    expect(layout.getByRole('radio', { name: 'Sidebar layout (Ctrl+1)' })).toBeChecked();
    expect(screen.getByRole('navigation', { name: 'Steps' })).toBeInTheDocument();

    await userEvent.click(layout.getByRole('radio', { name: 'Minimal layout (Ctrl+2)' }));
    expect(screen.queryByRole('navigation', { name: 'Steps' })).toBeNull();
    await userEvent.keyboard('{Control>}3{/Control}');
    expect(layout.getByRole('radio', { name: 'Guide layout (Ctrl+3)' })).toBeChecked();
    expect(screen.getByRole('complementary', { name: 'Guide' })).toBeInTheDocument();
    await userEvent.keyboard('{Control>}1{/Control}');
    expect(screen.getByRole('navigation', { name: 'Steps' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?step=s4');
  });

  it('F-07.1 the focused note survives a layout switch', async () => {
    await openStep4();
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Note 1: The whole photo goes into SQLite as byte[]',
      }),
    );
    act(() => {
      useFocusStore.getState().setLayout('B');
    });
    expect(
      screen.getByRole('article', {
        name: 'Claude note: The whole photo goes into SQLite as byte[]',
      }),
    ).toBeInTheDocument();
  });

  it('F-07.8 layout B: progress segments in the title bar and the floating toolbar', async () => {
    await openStep4();
    act(() => {
      useFocusStore.getState().setLayout('B');
    });
    expect(
      within(screen.getByTestId('title-bar')).getByRole('button', {
        name: 'Review plan: step 4 of 8',
      }),
    ).toBeInTheDocument();
    const bar = screen.getByRole('toolbar', { name: 'Step navigation' });
    expect(bar).toHaveTextContent('Step 4 of 8');
    for (const name of ['Previous step', 'Next step', 'Mark reviewed', 'Ask Claude']) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'ViewModel: queue instead of upload',
    );
    await userEvent.click(within(bar).getByRole('button', { name: 'Next step' }));
    expect(await screen.findByText('Step 5 of 8', { selector: 'span' })).toBeInTheDocument();
  });

  it('F-07.5 F-07.6 layout B keeps the 12px squares and the note inline under its line', async () => {
    await openStep4();
    act(() => {
      useFocusStore.getState().setLayout('B');
    });
    const mark = await screen.findByRole('button', { name: SECOND });
    expect(mark).toBeEmptyDOMElement();
    expect(
      screen.getByRole('article', { name: 'Claude note: PendingCount won’t refresh after upload' }),
    ).toBeInTheDocument();
  });

  it('F-07.5 F-07.7 layout C: numbered squares, the guide lists the notes with the focused one open', async () => {
    await openStep4();
    act(() => {
      useFocusStore.getState().setLayout('C');
    });
    const guide = await screen.findByRole('complementary', { name: 'Guide' });
    expect(within(guide).getByText('Worth a look')).toBeInTheDocument();
    expect(
      within(guide).getByRole('heading', { level: 1, name: 'ViewModel: queue instead of upload' }),
    ).toBeInTheDocument();
    // The gutter square carries the number; the note card moved from the diff into the guide.
    const squares = screen
      .getAllByRole('button', { name: /^Note \d: / })
      .filter((b) => !guide.contains(b));
    expect(squares.map((b) => b.textContent)).toEqual(
      ['1', '2', '3', '4'].slice(0, squares.length),
    );
    expect(squares.length).toBeGreaterThan(0);
    expect(within(guide).getAllByRole('article')).toHaveLength(1);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    // Mark reviewed (large) and the ask input at the bottom.
    expect(within(guide).getByRole('button', { name: 'Mark reviewed' })).toBeInTheDocument();
    expect(
      within(guide).getByRole('textbox', { name: 'Ask Claude about this step' }),
    ).toHaveAttribute('placeholder', 'Ask Claude about this step…');
    // Switching the focused note in the guide moves the open card.
    await userEvent.click(within(guide).getByRole('button', { name: /^Note 1: / }));
    expect(
      within(guide).getByRole('article', {
        name: 'Claude note: The whole photo goes into SQLite as byte[]',
      }),
    ).toBeInTheDocument();
  });

  it('F-10.1 F-10.2 F-10.3 layout C: a question in the guide streams an answer card, Add to drafts', async () => {
    await openStep4();
    act(() => {
      useFocusStore.getState().setLayout('C');
    });
    const guide = await screen.findByRole('complementary', { name: 'Guide' });
    const input = within(guide).getByRole('textbox', { name: 'Ask Claude about this step' });
    await userEvent.type(input, 'Why a queue?{Enter}');
    const answer = await within(guide).findByRole('article', { name: 'Claude answer' });
    expect(
      await within(answer).findByRole('button', { name: 'Add to drafts' }),
    ).toBeInTheDocument();
    await userEvent.click(within(answer).getByRole('button', { name: 'Add to drafts' }));
    expect(await within(answer).findByText(/Added to drafts/)).toBeInTheDocument();
  });

  it('F-10.1 layout B: Ask Claude opens the answer card under the step header with the input focused', async () => {
    await openStep4();
    act(() => {
      useFocusStore.getState().setLayout('B');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Ask Claude' }));
    const answer = await screen.findByRole('article', { name: 'Claude answer' });
    expect(
      within(answer).getByRole('textbox', { name: 'Ask Claude about this step' }),
    ).toHaveFocus();
  });

  it('F-10.1 More > Ask Claude on a note opens the answer card under its line', async () => {
    await openStep4();
    const card = await screen.findByRole('article', {
      name: 'Claude note: PendingCount won’t refresh after upload',
    });
    await userEvent.click(within(card).getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Ask Claude' }));
    expect(await screen.findByRole('article', { name: 'Claude answer' })).toBeInTheDocument();
  });
});
