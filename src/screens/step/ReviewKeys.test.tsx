import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { FindingDecision } from '../../ipc/types/FindingDecision';
import { useFocusStore, type FocusLayout } from '../../state/focus';
import { NO_REVIEW, useReviewStore } from '../../state/review';
import { renderApp } from '../../test/renderApp';

// F-30.6 on S-03 (M4 plan, decisions 14 and 15): ↓/↑ the current change over the step's files in
// diff order (the walk is in ArrowWalk.test.tsx), Space the current file, N the next note in line
// order (wraps), D/X on the focused note, A ask, Ctrl+Shift+O Rider at the current line. Single-letter keys don't fire in text
// fields or with Ctrl/Alt held, but do fire while a button has focus.

const MR_SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const CONVERTER = 'src/Mobile.App/Converters/PendingCountConverter.cs';
const BANNER = 'src/Mobile.App/Views/OfflineBanner.xaml';
const SQLITE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
const PHOTO = 'The whole photo goes into SQLite as byte[]';
const PENDING = 'PendingCount won’t refresh after upload';
const STATUS = 'Status texts are hardcoded';
const CANCEL = 'catch (Exception) also catches camera cancellation';
const ADDED = 'Added to drafts. It reaches GitLab only when you publish.';
const KEPT = "Kept to fix. It's on your list at the end.";
const DISMISSED = "Dismissed. Claude won't raise it again for this commit.";

interface Calls {
  decide: [string, string, FindingDecision][];
  rider: [string, number, string | undefined][];
}

/** S-03 on `step` of a session of the given kind, opened as S-01 opens it. */
async function openStep(
  step: string,
  { kind = 'mr', layout = 'A' }: { kind?: 'mr' | 'local'; layout?: FocusLayout } = {},
) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const sessionId =
    kind === 'mr' ? MR_SESSION : (await ipc.sessionOpenLocal({ kind: 'staged' })).sessionId;
  const calls: Calls = { decide: [], rider: [] };
  const client: IpcClient = {
    ...ipc,
    reviewDecide: (session, finding, decision) => {
      calls.decide.push([session, finding, decision]);
      return ipc.reviewDecide(session, finding, decision);
    },
    riderOpen: (file, line, session) => {
      calls.rider.push([file, line, session]);
      return Promise.resolve();
    },
  };
  const app = renderApp({ screen: 'S-03', sessionId }, client);
  await app.router.navigate(`/session/${sessionId}/step?step=${step}`);
  expect(await screen.findByText(`Step ${step.slice(1)} of 8`)).toBeInTheDocument();
  if (layout !== 'A') {
    act(() => {
      useFocusStore.getState().setLayout(layout);
    });
  }
  return { ...app, sessionId, calls };
}

const press = (keys: string) => userEvent.keyboard(keys);

/** Layout A's gutter square of a note; the focused note's is pressed. */
const mark = (title: string) =>
  screen.getByRole('button', { name: (name) => name.startsWith('Note') && name.endsWith(title) });

async function expectFocusedNote(title: string) {
  await waitFor(() => {
    expect(mark(title)).toHaveAttribute('aria-pressed', 'true');
  });
  expect(screen.getByRole('article', { name: `Claude note: ${title}` })).toBeInTheDocument();
}

/**
 * The change ↓/↑ made current: the one element of the page marked `aria-current="true"` (the focus
 * outline), and the file of the step it is in.
 */
function currentHunkFile(): string | null {
  const marked = document.querySelectorAll('[aria-current="true"]');
  expect(marked.length).toBeLessThanOrEqual(1);
  return marked[0]?.closest('section')?.getAttribute('aria-label') ?? null;
}

async function expectCurrentHunkIn(path: string) {
  await waitFor(() => {
    expect(currentHunkFile()).toBe(path);
  });
}

describe('S-03 review keys (F-30.6)', () => {
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    useReviewStore.setState({ key: null, ...NO_REVIEW });
    // jsdom lays nothing out: a measured diff row is one line high and the column is tall, so the
    // step's lines render, as in GuideKeys.test.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('F-30.6 ↓ opens the next step after the end-of-step pause; with Ctrl held it does nothing', async () => {
    const { router } = await openStep('s5');
    await press('{Control>}{ArrowDown}{/Control}');
    expect(currentHunkFile()).toBeNull();
    // First change, past the first file (marks it), past the last file (marks it, pauses).
    await press('{ArrowDown}{ArrowDown}');
    await expectCurrentHunkIn(BANNER);
    await press('{ArrowDown}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reviewed' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(screen.getByText('Step 5 of 8')).toBeInTheDocument();
    await press('{ArrowDown}');
    expect(await screen.findByText('Step 6 of 8')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?step=s6');
  });

  it('F-30.6 ↑ opens the previous step after the start-of-step pause; on step 1 it stays', async () => {
    await openStep('s2');
    await press('{ArrowDown}');
    await expectCurrentHunkIn(SQLITE);
    await press('{ArrowUp}');
    expect(screen.getByText('Step 2 of 8')).toBeInTheDocument();
    await press('{ArrowUp}');
    expect(await screen.findByText('Step 1 of 8')).toBeInTheDocument();
    for (let n = 0; n < 3; n++) await press('{ArrowUp}');
    expect(screen.getByText('Step 1 of 8')).toBeInTheDocument();
    expect(screen.queryByText('Step 8 of 8')).not.toBeInTheDocument();
  });

  it('F-30.6 Space marks the first file before any move, not the step, and Space again takes it back', async () => {
    await openStep('s5');
    const button = screen.getByRole('button', { name: /^(Mark reviewed|Reviewed)$/ });
    const toggle = screen.getByRole('button', { name: `Mark ${CONVERTER} reviewed` });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await press(' ');
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });
    // Step 5 has two files: marking one does not make the step reviewed.
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await press(' ');
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('F-30.6 ↓ and ↑ move the current change over the step’s files in diff order', async () => {
    await openStep('s5');
    expect(currentHunkFile()).toBeNull();
    await press('{ArrowDown}');
    await expectCurrentHunkIn(CONVERTER);
    await press('{ArrowDown}');
    await expectCurrentHunkIn(BANNER);
    await press('{ArrowUp}');
    await expectCurrentHunkIn(CONVERTER);
  });

  it('F-30.6 N moves to the next note in line order and wraps after the last', async () => {
    await openStep('s4');
    // The step opens on its first Should fix (Review.dc.html f2).
    await expectFocusedNote(PENDING);
    await press('n');
    await expectFocusedNote(STATUS);
    await press('n');
    await expectFocusedNote(CANCEL);
    await press('n');
    await expectFocusedNote(PHOTO);
  });

  it('F-30.6 D adds the focused note to drafts', async () => {
    const { calls } = await openStep('s4');
    await expectFocusedNote(PENDING);
    await press('d');
    const card = screen.getByRole('article', { name: `Claude note: ${PENDING}` });
    expect(await within(card).findByText(ADDED)).toBeInTheDocument();
    expect(calls.decide).toEqual([[MR_SESSION, 'f2', { kind: 'addToDrafts' }]]);
  });

  it('F-30.6 X dismisses the focused note', async () => {
    const { calls } = await openStep('s4');
    await press('n');
    await expectFocusedNote(STATUS);
    await press('x');
    const card = screen.getByRole('article', { name: `Claude note: ${STATUS}` });
    expect(await within(card).findByText(DISMISSED)).toBeInTheDocument();
    expect(calls.decide).toEqual([[MR_SESSION, 'f3', { kind: 'dismiss' }]]);
  });

  it('F-30.6 D and X do nothing on a note already decided', async () => {
    const { calls } = await openStep('s4');
    await press('d');
    const card = screen.getByRole('article', { name: `Claude note: ${PENDING}` });
    expect(await within(card).findByText(ADDED)).toBeInTheDocument();
    await press('x');
    await press('d');
    expect(within(card).getByText(ADDED)).toBeInTheDocument();
    expect(within(card).queryByText(DISMISSED)).not.toBeInTheDocument();
    expect(calls.decide).toHaveLength(1);
  });

  it('F-30.6 in a self-review D keeps the focused note to fix', async () => {
    const { calls, sessionId } = await openStep('s4', { kind: 'local' });
    await expectFocusedNote(PENDING);
    await press('d');
    const card = screen.getByRole('article', { name: `Claude note: ${PENDING}` });
    expect(await within(card).findByText(KEPT)).toBeInTheDocument();
    expect(calls.decide).toEqual([[sessionId, 'f2', { kind: 'addToDrafts' }]]);
  });

  it('F-30.6 D and X type in a text field and do nothing with Alt held; alone they act', async () => {
    const { calls } = await openStep('s4');
    await expectFocusedNote(PENDING);
    // C opens the line composer with its text field focused (F-09.7).
    await press('c');
    const field = await screen.findByRole('textbox', { name: 'Comment' });
    await waitFor(() => {
      expect(field).toHaveFocus();
    });
    await userEvent.type(field, 'dx');
    expect(field).toHaveValue('dx');
    expect(calls.decide).toEqual([]);
    await userEvent.click(screen.getByRole('heading', { level: 1 }));
    await press('{Alt>}d{/Alt}');
    await press('{Alt>}x{/Alt}');
    expect(calls.decide).toEqual([]);
    await press('x');
    await waitFor(() => {
      expect(calls.decide).toEqual([[MR_SESSION, 'f2', { kind: 'dismiss' }]]);
    });
  });

  it('F-30.6 a single-letter key still fires while a button has focus', async () => {
    await openStep('s4');
    await expectFocusedNote(PENDING);
    const button = screen.getByRole('button', { name: /Mark reviewed|Reviewed/ });
    act(() => {
      button.focus();
    });
    await press('n');
    await expectFocusedNote(STATUS);
  });

  it('F-30.6 A opens the answer card with its question field focused', async () => {
    await openStep('s4');
    expect(screen.queryByRole('article', { name: 'Claude answer' })).not.toBeInTheDocument();
    await press('a');
    const card = await screen.findByRole('article', { name: 'Claude answer' });
    const input = within(card).getByRole('textbox', { name: 'Ask Claude about this step' });
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    // A typed there is a letter of the question.
    await userEvent.keyboard('a');
    expect(input).toHaveValue('a');
  });

  it('F-30.6 A in layout C focuses the guide panel’s ask field', async () => {
    await openStep('s4', { layout: 'C' });
    await press('a');
    const guide = screen.getByRole('complementary', { name: 'Guide' });
    await waitFor(() => {
      expect(
        within(guide).getAllByRole('textbox', { name: 'Ask Claude about this step' }),
      ).toContainEqual(document.activeElement);
    });
  });

  it('F-30.6 Ctrl+Shift+O opens the file in Rider at the focused note’s line', async () => {
    const { calls } = await openStep('s4');
    await expectFocusedNote(PENDING);
    await press('{Control>}{Shift>}O{/Shift}{/Control}');
    await waitFor(() => {
      expect(calls.rider).toEqual([[VM, 49, MR_SESSION]]);
    });
  });

  it('F-30.6 Ctrl+Shift+O on a step without notes opens the current change’s file at its first line', async () => {
    const { calls } = await openStep('s5');
    await press('{ArrowDown}');
    await press('{ArrowDown}');
    await expectCurrentHunkIn(BANNER);
    await press('{Control>}{Shift>}O{/Shift}{/Control}');
    await waitFor(() => {
      expect(calls.rider).toEqual([[BANNER, 1, MR_SESSION]]);
    });
  });
});
