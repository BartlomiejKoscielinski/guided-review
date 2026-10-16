import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { useFocusStore, type FocusLayout } from '../../state/focus';
import { NO_REVIEW, useReviewStore } from '../../state/review';
import { renderApp } from '../../test/renderApp';

// F-07.10 on S-03 (layouts A, B and C): the file header has a Reviewed toggle (pressed = green
// fill; "Mark <path> reviewed" for assistive technology). Pressing it marks that file only; a step
// is reviewed when all its files are; Mark reviewed marks all its files and on a reviewed step
// unmarks them; Space toggles the current file (the file of the current change, else the step's
// first file) and leaves the step's own button to the files. The green fill is checked in
// tests/e2e/step-f07-10.spec.ts, the restart in src/ipc/mock/fileMarks.test.ts and the e2e spec.

const MR_SESSION = 'mock-mr-session-1';
// Step 5 has two files in the diff's order, one hunk each; step 4 has one file.
const CONVERTER = 'src/Mobile.App/Converters/PendingCountConverter.cs';
const BANNER = 'src/Mobile.App/Views/OfflineBanner.xaml';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';

interface Calls {
  file: [string, string, string, boolean][];
  step: [string, string, boolean][];
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
  const calls: Calls = { file: [], step: [] };
  const client: IpcClient = {
    ...ipc,
    reviewMarkFile: (session, stepId, file, reviewed) => {
      calls.file.push([session, stepId, file, reviewed]);
      return ipc.reviewMarkFile(session, stepId, file, reviewed);
    },
    reviewMarkStep: (session, stepId, reviewed) => {
      calls.step.push([session, stepId, reviewed]);
      return ipc.reviewMarkStep(session, stepId, reviewed);
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

/** The Reviewed toggle in the header of a file of the step. */
const toggle = (path: string) =>
  within(screen.getByRole('region', { name: path })).getByRole('button', {
    name: `Mark ${path} reviewed`,
  });
/** The step's own button: Mark reviewed, Reviewed once the step is. */
const stepButton = () => screen.getByRole('button', { name: /^(Mark reviewed|Reviewed)$/ });
const stepsList = () => screen.getByRole('navigation', { name: 'Steps' });

async function expectPressed(path: string, pressed: boolean) {
  await waitFor(() => {
    expect(toggle(path)).toHaveAttribute('aria-pressed', String(pressed));
  });
}

async function expectStepReviewed(reviewed: boolean) {
  await waitFor(() => {
    expect(stepButton()).toHaveAttribute('aria-pressed', String(reviewed));
  });
  expect(stepButton()).toHaveAccessibleName(reviewed ? 'Reviewed' : 'Mark reviewed');
}

/** The file of the step the hunk J/K made current is in (the element marked `aria-current`). */
function currentHunkFile(): string | null {
  const marked = document.querySelectorAll('[aria-current="true"]');
  expect(marked.length).toBeLessThanOrEqual(1);
  return marked[0]?.closest('section')?.getAttribute('aria-label') ?? null;
}

describe('S-03 file marks (F-07.10)', () => {
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    useReviewStore.setState({ key: null, ...NO_REVIEW });
    // jsdom lays nothing out: a measured diff row is one line high and the column is tall, so the
    // step's lines render, as in ReviewKeys.test.
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

  it('F-07.10 each file header has a Reviewed toggle named after its file, not pressed at first', async () => {
    await openStep('s5');
    for (const path of [CONVERTER, BANNER]) {
      expect(toggle(path)).toHaveAttribute('aria-pressed', 'false');
      expect(toggle(path)).toHaveTextContent('Reviewed');
    }
    await expectStepReviewed(false);
  });

  it('F-07.10 pressing a file’s toggle marks that file only; the step is reviewed with its last file', async () => {
    const { calls } = await openStep('s5');
    const list = stepsList();
    await userEvent.click(toggle(CONVERTER));
    await expectPressed(CONVERTER, true);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'false');
    await expectStepReviewed(false);
    expect(list).toHaveTextContent('0/8');
    expect(calls.file).toEqual([[MR_SESSION, 's5', CONVERTER, true]]);
    expect(calls.step).toEqual([]);

    await userEvent.click(toggle(BANNER));
    await expectStepReviewed(true);
    expect(toggle(CONVERTER)).toHaveAttribute('aria-pressed', 'true');
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(list).toHaveTextContent('1/8');
    });

    // One file taken back: the step is not reviewed any more, the other file stays marked.
    await userEvent.click(toggle(CONVERTER));
    await expectPressed(CONVERTER, false);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'true');
    await expectStepReviewed(false);
    await waitFor(() => {
      expect(list).toHaveTextContent('0/8');
    });
    expect(calls.file.map((call) => call.slice(2))).toEqual([
      [CONVERTER, true],
      [BANNER, true],
      [CONVERTER, false],
    ]);
    expect(calls.step).toEqual([]);
  });

  it('F-07.10 Mark reviewed marks every file of the step; on a reviewed step it unmarks them', async () => {
    const { calls } = await openStep('s5');
    await userEvent.click(toggle(BANNER));
    await expectPressed(BANNER, true);
    // A file already marked stays marked: Mark reviewed marks the rest, it does not toggle.
    await userEvent.click(stepButton());
    await expectStepReviewed(true);
    await expectPressed(CONVERTER, true);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'true');
    expect(calls.step).toEqual([[MR_SESSION, 's5', true]]);

    await userEvent.click(stepButton());
    await expectStepReviewed(false);
    await expectPressed(CONVERTER, false);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'false');
    expect(calls.step).toEqual([
      [MR_SESSION, 's5', true],
      [MR_SESSION, 's5', false],
    ]);
  });

  it('F-07.10 taking one file back from a step marked as a whole keeps the other file marked', async () => {
    await openStep('s5');
    await userEvent.click(stepButton());
    await expectStepReviewed(true);
    await userEvent.click(toggle(BANNER));
    await expectPressed(BANNER, false);
    expect(toggle(CONVERTER)).toHaveAttribute('aria-pressed', 'true');
    await expectStepReviewed(false);
    await waitFor(() => {
      expect(stepsList()).toHaveTextContent('0/8');
    });
  });

  it('F-07.10 on a step of one file the file’s toggle and Mark reviewed are the same state', async () => {
    await openStep('s4');
    await userEvent.click(toggle(VM));
    await expectStepReviewed(true);
    expect(toggle(VM)).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(stepButton());
    await expectStepReviewed(false);
    await expectPressed(VM, false);
  });

  it('F-07.10 Space toggles the first file of the step before any move and does not mark the step', async () => {
    const { calls } = await openStep('s5');
    await press(' ');
    await expectPressed(CONVERTER, true);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'false');
    await expectStepReviewed(false);
    expect(calls.file).toEqual([[MR_SESSION, 's5', CONVERTER, true]]);
    expect(calls.step).toEqual([]);

    await press(' ');
    await expectPressed(CONVERTER, false);
    expect(calls.file.map((call) => call[3])).toEqual([true, false]);
    expect(calls.step).toEqual([]);
  });

  it('F-07.10 Space on a step of one file marks that file, so the step is reviewed', async () => {
    const { calls } = await openStep('s4');
    await press(' ');
    await expectStepReviewed(true);
    expect(toggle(VM)).toHaveAttribute('aria-pressed', 'true');
    expect(calls.file).toEqual([[MR_SESSION, 's4', VM, true]]);
    expect(calls.step).toEqual([]);
    await press(' ');
    await expectStepReviewed(false);
  });

  it('F-07.10 Space toggles the file of the current change and does not move it', async () => {
    await openStep('s5');
    await press('j');
    await waitFor(() => {
      expect(currentHunkFile()).toBe(CONVERTER);
    });
    await press('j');
    await waitFor(() => {
      expect(currentHunkFile()).toBe(BANNER);
    });
    await press(' ');
    await expectPressed(BANNER, true);
    expect(toggle(CONVERTER)).toHaveAttribute('aria-pressed', 'false');
    expect(currentHunkFile()).toBe(BANNER);

    await press('k');
    await waitFor(() => {
      expect(currentHunkFile()).toBe(CONVERTER);
    });
    await press(' ');
    await expectPressed(CONVERTER, true);
    await expectStepReviewed(true);
    expect(currentHunkFile()).toBe(CONVERTER);
  });

  it('F-07.10 on a control Space presses the control once: no second toggle from the shortcut', async () => {
    const { calls } = await openStep('s5');
    await userEvent.click(toggle(CONVERTER));
    await expectPressed(CONVERTER, true);
    await press(' ');
    await expectPressed(CONVERTER, false);
    expect(calls.file.map((call) => call[3])).toEqual([true, false]);
  });

  it('F-07.10 in layouts B and C the file headers carry the toggle and the step’s button follows', async () => {
    for (const layout of ['B', 'C'] as const) {
      const { unmount, calls } = await openStep('s5', { layout });
      await userEvent.click(toggle(CONVERTER));
      await expectPressed(CONVERTER, true);
      await expectStepReviewed(false);
      await userEvent.click(toggle(BANNER));
      await expectStepReviewed(true);
      expect(calls.file.map((call) => call[3])).toEqual([true, true]);
      expect(calls.step).toEqual([]);
      unmount();
    }
  });

  it('F-07.10 a self-review has the toggles too', async () => {
    const { calls, sessionId } = await openStep('s4', { kind: 'local' });
    await userEvent.click(toggle(VM));
    await expectStepReviewed(true);
    expect(calls.file).toEqual([[sessionId, 's4', VM, true]]);
  });
});
