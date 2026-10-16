import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { useFocusStore } from '../../state/focus';
import { NO_REVIEW, useReviewStore } from '../../state/review';
import { renderApp } from '../../test/renderApp';

// F-07.10 on S-04: the sticky file bar of each file has the Reviewed toggle (pressed = green fill;
// "Mark <path> reviewed" for assistive technology), with the same meaning as the file header on
// S-03: it marks that file only, the step is reviewed when all its files are, the step header's
// Mark reviewed marks all its files and on a reviewed step unmarks them, and Space toggles the
// current file (the file of the current change, else the step's first file). The green fill is
// checked in tests/e2e/detailed-f07-10.spec.ts.

const SESSION = 'mock-mr-session-1';
// Step 5 has two files in the diff's order, one hunk each.
const CONVERTER = 'src/Mobile.App/Converters/PendingCountConverter.cs';
const BANNER = 'src/Mobile.App/Views/OfflineBanner.xaml';

interface Calls {
  file: [string, string, string, boolean][];
  step: [string, string, boolean][];
}

/** S-04 on !482's step `step`, its plan prepared as S-02 does. */
async function openDetailed(step: string) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  await ipc.reviewPlan(SESSION, () => undefined);
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
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=${step}`);
  await screen.findByRole('heading', { level: 1 });
  expect(await screen.findByText(`Step ${step.slice(1)} / 8`)).toBeInTheDocument();
  return { ...app, calls };
}

const press = (keys: string) => userEvent.keyboard(keys);

/** The Reviewed toggle in the file bar of a file of the step. */
const toggle = (path: string) =>
  within(screen.getByRole('region', { name: path })).getByRole('button', {
    name: `Mark ${path} reviewed`,
  });
/** The step header's own button: Mark reviewed, Reviewed once the step is (its Space hint follows). */
const stepButton = () => screen.getByRole('button', { name: /^(Mark reviewed|Reviewed)/ });

async function expectPressed(path: string, pressed: boolean) {
  await waitFor(() => {
    expect(toggle(path)).toHaveAttribute('aria-pressed', String(pressed));
  });
}

async function expectStepReviewed(reviewed: boolean) {
  await waitFor(() => {
    expect(stepButton()).toHaveAttribute('aria-pressed', String(reviewed));
  });
  expect(stepButton()).toHaveTextContent(reviewed ? /^Reviewed/ : /^Mark reviewed/);
}

/** The file of the step the change ↓/↑ (or →/←) made current is in (the element marked `aria-current`). */
function currentHunkFile(): string | null {
  const marked = document.querySelectorAll('[aria-current="true"]');
  expect(marked.length).toBeLessThanOrEqual(1);
  return marked[0]?.closest('section')?.getAttribute('aria-label') ?? null;
}

describe('S-04 file marks (F-07.10)', () => {
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

  it('F-07.10 each sticky file bar has a Reviewed toggle named after its file, not pressed at first', async () => {
    await openDetailed('s5');
    for (const path of [CONVERTER, BANNER]) {
      expect(toggle(path)).toHaveAttribute('aria-pressed', 'false');
      expect(toggle(path)).toHaveTextContent('Reviewed');
    }
    await expectStepReviewed(false);
  });

  it('F-07.10 pressing a file’s toggle marks that file only; the step is reviewed with its last file', async () => {
    const { calls } = await openDetailed('s5');
    await userEvent.click(toggle(CONVERTER));
    await expectPressed(CONVERTER, true);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'false');
    await expectStepReviewed(false);
    expect(calls.file).toEqual([[SESSION, 's5', CONVERTER, true]]);
    expect(calls.step).toEqual([]);

    await userEvent.click(toggle(BANNER));
    await expectStepReviewed(true);
    expect(toggle(CONVERTER)).toHaveAttribute('aria-pressed', 'true');

    // One file taken back: the step is not reviewed any more, the other file stays marked.
    await userEvent.click(toggle(CONVERTER));
    await expectPressed(CONVERTER, false);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'true');
    await expectStepReviewed(false);
    expect(calls.step).toEqual([]);
  });

  it('F-07.10 Mark reviewed marks every file of the step; on a reviewed step it unmarks them', async () => {
    const { calls } = await openDetailed('s5');
    await userEvent.click(toggle(BANNER));
    await expectPressed(BANNER, true);
    await userEvent.click(stepButton());
    await expectStepReviewed(true);
    await expectPressed(CONVERTER, true);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'true');
    expect(calls.step).toEqual([[SESSION, 's5', true]]);

    await userEvent.click(stepButton());
    await expectStepReviewed(false);
    await expectPressed(CONVERTER, false);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'false');
  });

  it('F-07.10 Space toggles the first file before any move and does not mark the step', async () => {
    const { calls } = await openDetailed('s5');
    await press(' ');
    await expectPressed(CONVERTER, true);
    expect(toggle(BANNER)).toHaveAttribute('aria-pressed', 'false');
    await expectStepReviewed(false);
    expect(calls.file).toEqual([[SESSION, 's5', CONVERTER, true]]);
    expect(calls.step).toEqual([]);
    await press(' ');
    await expectPressed(CONVERTER, false);
  });

  it('F-07.10 Space toggles the file of the current change and does not move it', async () => {
    await openDetailed('s5');
    await press('{ArrowRight}');
    await waitFor(() => {
      expect(currentHunkFile()).toBe(BANNER);
    });
    await press(' ');
    await expectPressed(BANNER, true);
    expect(toggle(CONVERTER)).toHaveAttribute('aria-pressed', 'false');
    expect(currentHunkFile()).toBe(BANNER);
  });

  it('F-07.10 on a control Space presses the control once: no second toggle from the shortcut', async () => {
    const { calls } = await openDetailed('s5');
    await userEvent.click(toggle(CONVERTER));
    await expectPressed(CONVERTER, true);
    await press(' ');
    await expectPressed(CONVERTER, false);
    expect(calls.file.map((call) => call[3])).toEqual([true, false]);
  });
});
