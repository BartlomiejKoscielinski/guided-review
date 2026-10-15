import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import type { AskAnswer } from '../../ipc/types/AskAnswer';
import type { LineSelection } from '../../ipc/types/LineSelection';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-10.1: a question is about the current step and, if any, the selected lines. The reviewer
// selects lines with the line numbers of the diff (no mock shows this; M3 decision recorded in
// the tests stage of F-10.1):
//   - a click on a line number selects that line, Shift+click extends it to a range (either
//     direction) on the same side of the same file; a selected line carries data-selected="true";
//   - a group "Selected lines" under the last selected line says "Line 47" / "Lines 47–50" (new
//     side) or "Line 37 (old)" / "Lines 37–38 (old)" and has the buttons Ask Claude and Clear;
//   - Ask Claude there opens the answer card (input focused) for exactly those lines; the card
//     repeats the label of its lines; Esc clears the selection like Clear;
//   - B's toolbar Ask Claude and C's guide input ask about the selection too; the selection
//     belongs to the step and survives layout switches.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const BANNER = 'src/Mobile.App/Views/OfflineBanner.xaml';
const CONVERTER = 'src/Mobile.App/Converters/PendingCountConverter.cs';
const ANSWER = 'It keeps the photo until the network is back.';

interface AskCall {
  step: string;
  question: string;
  selection: LineSelection | null;
}

/** `reviewAsk` that records what the screen asks and answers at once. */
function recordedAsk() {
  const calls: AskCall[] = [];
  const reviewAsk: IpcClient['reviewAsk'] = (_session, step, question, selection, onEvent) => {
    calls.push({ step, question, selection });
    const result: AskAnswer = { text: ANSWER, followUp: false };
    onEvent({ kind: 'done', result });
    return Promise.resolve(result);
  };
  return { calls, reviewAsk };
}

/** The number cell of a diff line: split rows show a context line on both sides. */
function line(kind: 'add' | 'del' | 'ctx', no: number, root: ParentNode = document): HTMLElement {
  const found = root.querySelector<HTMLElement>(
    `[data-kind="${kind}"] [data-line-no="${String(no)}"]`,
  );
  if (!found) throw new Error(`${kind} line ${String(no)} is not in the diff`);
  return found;
}

async function shiftClick(element: HTMLElement) {
  await userEvent.keyboard('{Shift>}');
  await userEvent.click(element);
  await userEvent.keyboard('{/Shift}');
}

async function openStep(step: string, number: number, client: Partial<IpcClient> = {}) {
  const app = renderApp({ screen: 'S-03', sessionId: SESSION }, client);
  await app.router.navigate(`/session/${SESSION}/step?step=${step}`);
  expect(await screen.findByText(`Step ${String(number)} of 8`)).toBeInTheDocument();
  return app;
}

/** Step 4 with its diff drawn. */
async function openStep4(client: Partial<IpcClient> = {}) {
  const app = await openStep('s4', 4, client);
  await waitFor(() => {
    line('add', 47);
  });
  return app;
}

const selectedBar = () => screen.getByRole('group', { name: 'Selected lines' });
const noBar = () => {
  expect(screen.queryByRole('group', { name: 'Selected lines' })).toBeNull();
};

/** The line numbers carrying the selection highlight, in diff order. */
const highlighted = () =>
  Array.from(document.querySelectorAll('[data-selected="true"]')).map((half) =>
    half.querySelector('[data-line-no]')?.getAttribute('data-line-no'),
  );

/** `after` comes later in the document than `before`. */
const follows = (before: Node, after: Node) =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const setLayout = (layout: 'A' | 'B' | 'C') => {
  act(() => {
    useFocusStore.getState().setLayout(layout);
  });
};

/** Types into the answer card that is open and waits for the question to be asked. */
async function typeInCard(card: HTMLElement, question: string) {
  const input = within(card).getByRole('textbox', { name: 'Ask Claude about this step' });
  expect(input).toHaveFocus();
  await userEvent.type(input, `${question}{Enter}`);
  expect(await within(card).findByText(ANSWER)).toBeInTheDocument();
}

describe('S-03 selected lines (F-10.1)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-10.1 a click on a line number selects that line under a "Selected lines" group; another click moves it', async () => {
    await openStep4();
    noBar();
    expect(highlighted()).toEqual([]);

    await userEvent.click(line('add', 47));
    expect(within(selectedBar()).getByText('Line 47')).toBeInTheDocument();
    expect(highlighted()).toEqual(['47']);
    // The group sits under the selected line.
    expect(follows(line('add', 47), selectedBar())).toBe(true);
    expect(follows(selectedBar(), line('add', 48))).toBe(true);

    await userEvent.click(line('add', 50));
    expect(within(selectedBar()).getByText('Line 50')).toBeInTheDocument();
    expect(highlighted()).toEqual(['50']);
  });

  it('F-10.1 Shift+click extends the selection to a range, upwards as well as downwards', async () => {
    await openStep4();
    await userEvent.click(line('add', 47));
    await shiftClick(line('add', 50));
    expect(within(selectedBar()).getByText('Lines 47–50')).toBeInTheDocument();
    expect(highlighted()).toEqual(['47', '48', '49', '50']);

    await userEvent.click(line('add', 52));
    await shiftClick(line('add', 50));
    expect(within(selectedBar()).getByText('Lines 50–52')).toBeInTheDocument();
    expect(highlighted()).toEqual(['50', '51', '52']);
    await userEvent.click(line('add', 50));
    await shiftClick(line('add', 47));
    expect(within(selectedBar()).getByText('Lines 47–50')).toBeInTheDocument();
  });

  it('F-10.1 Ask Claude on the selected lines asks in this step about those lines; the card sits under them', async () => {
    const { calls, reviewAsk } = recordedAsk();
    await openStep4({ reviewAsk });
    await userEvent.click(line('add', 47));
    await shiftClick(line('add', 50));

    await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Ask Claude' }));
    const card = await screen.findByRole('article', { name: 'Claude answer' });
    await typeInCard(card, 'Why is the worker kicked here?');

    expect(calls).toEqual([
      {
        step: 's4',
        question: 'Why is the worker kicked here?',
        selection: { file: VM, side: 'new', start: 47, end: 50 },
      },
    ]);
    // The card says which lines it is about and sits under the last of them (A and B).
    expect(within(card).getByText('Lines 47–50')).toBeInTheDocument();
    expect(follows(line('add', 50), card)).toBe(true);
    expect(follows(card, line('add', 51))).toBe(true);
  });

  it('F-10.1 a deleted line selects on the old side, whichever way the range is dragged', async () => {
    const { calls, reviewAsk } = recordedAsk();
    await openStep4({ reviewAsk });
    await userEvent.click(line('del', 38));
    expect(within(selectedBar()).getByText('Line 38 (old)')).toBeInTheDocument();
    await shiftClick(line('del', 37));
    expect(within(selectedBar()).getByText('Lines 37–38 (old)')).toBeInTheDocument();
    expect(highlighted()).toEqual(['37', '38']);

    await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Ask Claude' }));
    await typeInCard(await screen.findByRole('article', { name: 'Claude answer' }), 'Why removed?');
    expect(calls.map((c) => c.selection)).toEqual([{ file: VM, side: 'old', start: 37, end: 38 }]);
  });

  it('F-10.1 a context line selects on the side of the number clicked; a range never joins two sides', async () => {
    await openStep4();
    // Old 36 / new 45 is one context row.
    await userEvent.click(line('ctx', 36));
    expect(within(selectedBar()).getByText('Line 36 (old)')).toBeInTheDocument();
    await userEvent.click(line('ctx', 45));
    expect(within(selectedBar()).getByText('Line 45')).toBeInTheDocument();

    // Shift+click on the other side starts a new selection there.
    await userEvent.click(line('add', 47));
    await shiftClick(line('del', 37));
    expect(within(selectedBar()).getByText('Line 37 (old)')).toBeInTheDocument();
    expect(highlighted()).toEqual(['37']);
  });

  it('F-10.1 a selection stays in one file: Shift+click in another file starts over there', async () => {
    const { calls, reviewAsk } = recordedAsk();
    await openStep('s5', 5, { reviewAsk });
    const banner = await screen.findByRole('region', { name: BANNER });
    const converter = await screen.findByRole('region', { name: CONVERTER });
    await waitFor(() => {
      line('add', 5, converter);
      line('add', 6, banner);
    });

    await userEvent.click(line('add', 3, banner));
    await shiftClick(line('add', 6, banner));
    expect(within(selectedBar()).getByText('Lines 3–6')).toBeInTheDocument();

    await shiftClick(line('add', 5, converter));
    expect(within(selectedBar()).getByText('Line 5')).toBeInTheDocument();
    expect(highlighted()).toEqual(['5']);
    expect(converter.querySelectorAll('[data-selected="true"]')).toHaveLength(1);

    await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Ask Claude' }));
    await typeInCard(await screen.findByRole('article', { name: 'Claude answer' }), 'What is it?');
    expect(calls).toEqual([
      {
        step: 's5',
        question: 'What is it?',
        selection: { file: CONVERTER, side: 'new', start: 5, end: 5 },
      },
    ]);
  });

  it('F-10.1 a note square or the thread icon in the gutter keeps its own action and does not select the line', async () => {
    await openStep4();
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Note 1: The whole photo goes into SQLite as byte[]',
      }),
    );
    noBar();
    await userEvent.click(screen.getByRole('button', { name: 'Thread by Paweł S. at line 48' }));
    noBar();
    expect(highlighted()).toEqual([]);
  });

  it('F-10.1 Clear and Esc drop the selection; a question after that is about the whole step', async () => {
    const { calls, reviewAsk } = recordedAsk();
    await openStep4({ reviewAsk });
    await userEvent.click(line('add', 47));
    await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Clear' }));
    noBar();
    expect(highlighted()).toEqual([]);

    await userEvent.click(line('add', 50));
    await userEvent.keyboard('{Escape}');
    noBar();
    expect(highlighted()).toEqual([]);

    setLayout('B');
    await userEvent.click(
      within(screen.getByRole('toolbar', { name: 'Step navigation' })).getByRole('button', {
        name: 'Ask Claude',
      }),
    );
    const card = await screen.findByRole('article', { name: 'Claude answer' });
    await typeInCard(card, 'What does this step do?');
    expect(calls).toEqual([{ step: 's4', question: 'What does this step do?', selection: null }]);
    expect(within(card).queryByText(/^Lines? \d/)).toBeNull();
  });

  it('F-10.1 layout B: Ask Claude in the toolbar asks about the lines selected in the diff', async () => {
    const { calls, reviewAsk } = recordedAsk();
    await openStep4({ reviewAsk });
    await userEvent.click(line('add', 47));
    await shiftClick(line('add', 50));
    setLayout('B');
    // The selection is shared state of the step: it survives the switch.
    expect(within(selectedBar()).getByText('Lines 47–50')).toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole('toolbar', { name: 'Step navigation' })).getByRole('button', {
        name: 'Ask Claude',
      }),
    );
    const card = await screen.findByRole('article', { name: 'Claude answer' });
    await typeInCard(card, 'Is this safe?');
    expect(calls).toEqual([
      {
        step: 's4',
        question: 'Is this safe?',
        selection: { file: VM, side: 'new', start: 47, end: 50 },
      },
    ]);
    expect(within(card).getByText('Lines 47–50')).toBeInTheDocument();
  });

  it('F-10.1 layout C: a question typed in the guide carries the lines selected in the diff', async () => {
    const { calls, reviewAsk } = recordedAsk();
    await openStep4({ reviewAsk });
    await userEvent.click(line('add', 47));
    setLayout('C');

    const guide = await screen.findByRole('complementary', { name: 'Guide' });
    await userEvent.type(
      within(guide).getByRole('textbox', { name: 'Ask Claude about this step' }),
      'Why a queue?{Enter}',
    );
    const answer = await within(guide).findByRole('article', { name: 'Claude answer' });
    expect(await within(answer).findByText(ANSWER)).toBeInTheDocument();
    expect(calls).toEqual([
      {
        step: 's4',
        question: 'Why a queue?',
        selection: { file: VM, side: 'new', start: 47, end: 47 },
      },
    ]);
    // The answer is in the guide, away from the lines, so it names them.
    expect(within(answer).getByText('Line 47')).toBeInTheDocument();
  });

  it('F-10.1 layout C: Ask Claude in the selection group opens the answer card in the guide with the input focused', async () => {
    const { calls, reviewAsk } = recordedAsk();
    setLayout('C');
    await openStep4({ reviewAsk });
    await userEvent.click(line('add', 50));
    await shiftClick(line('add', 52));

    await userEvent.click(within(selectedBar()).getByRole('button', { name: 'Ask Claude' }));
    const guide = screen.getByRole('complementary', { name: 'Guide' });
    const card = await within(guide).findByRole('article', { name: 'Claude answer' });
    await typeInCard(card, 'Why two texts?');
    expect(calls.map((c) => c.selection)).toEqual([{ file: VM, side: 'new', start: 50, end: 52 }]);
  });

  it('F-10.1 the selection belongs to its step: the next step starts without one', async () => {
    const { calls, reviewAsk } = recordedAsk();
    await openStep4({ reviewAsk });
    await userEvent.click(line('add', 47));
    expect(within(selectedBar()).getByText('Line 47')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(await screen.findByText('Step 5 of 8')).toBeInTheDocument();
    noBar();
    expect(highlighted()).toEqual([]);

    setLayout('B');
    await userEvent.click(
      within(screen.getByRole('toolbar', { name: 'Step navigation' })).getByRole('button', {
        name: 'Ask Claude',
      }),
    );
    await typeInCard(await screen.findByRole('article', { name: 'Claude answer' }), 'What is it?');
    expect(calls).toEqual([{ step: 's5', question: 'What is it?', selection: null }]);
  });
});
