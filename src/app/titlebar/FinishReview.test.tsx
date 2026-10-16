import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';
import { pathFor } from '../routes';

// F-30.3: Finish review on the review screens opens S-05. The title bars of S-03 and S-04 have it,
// and the last step's Next does the same (M4 plan, decision 11): `↓` at the end of the last step
// moves the focus to Finish review (F-30.6, decision 15; Enter opens S-05), S-03's next arrow
// (layout A) and layout B's toolbar next; the S-04 end card's Finish review is F-08.9's. A commit
// session is a self-review, so S-05 is its summary with content to assert ("Nothing to fix.").

/** A commit session (a self-review) with its plan prepared as S-02 does, on its own backend. */
async function selfReview(): Promise<{ ipc: IpcClient; sessionId: string }> {
  const ipc = createMockClient({ latencyMs: 0, storage: null });
  await ipc.repoPick();
  const { sessionId } = await ipc.sessionOpenCommit({ to: 'a3f9c12' });
  await ipc.reviewPlan(sessionId, () => undefined);
  return { ipc, sessionId };
}

async function open(ipc: IpcClient, path: string, step: string) {
  const app = renderApp({ screen: 'S-01' }, ipc);
  await act(() => app.router.navigate(`${path}?step=${step}`));
  return app;
}

/** S-04 on a step of the session; the header's "Step n / 8" shows once the plan is read. */
async function openDetailed(ipc: IpcClient, sessionId: string, step: string, kicker: string) {
  const app = await open(ipc, pathFor({ screen: 'S-04', sessionId }), step);
  expect(await screen.findByText(kicker)).toBeInTheDocument();
  return app;
}

/** S-03 on a step of the session; "Step n of 8" shows once the step is read. */
async function openFocus(ipc: IpcClient, sessionId: string, step: string, kicker: string) {
  const app = await open(ipc, pathFor({ screen: 'S-03', sessionId }), step);
  expect(await screen.findByText(kicker, { selector: 'span' })).toBeInTheDocument();
  return app;
}

/** S-05 of a self-review with nothing kept and nothing marked: the summary's own copy. */
async function expectSummary(
  router: ReturnType<typeof renderApp>['router'],
  sessionId: string,
  reviewed = 0,
) {
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-05', sessionId }));
  });
  expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
  expect(await screen.findByText(`${String(reviewed)} of 8 steps reviewed.`)).toBeInTheDocument();
}

/** S-04's main column: the end-of-step card with its Finish review sits in it. */
const cardFinish = () => {
  const main = document.querySelector<HTMLElement>('main main');
  if (!main) throw new Error('no S-04 main column');
  return within(main).getByRole('button', { name: 'Finish review' });
};

/**
 * Walks the step with ↓ (first change, the files are marked, one pause at the end of the step)
 * until the focus is on the end card's Finish review.
 */
async function walkToFinish() {
  let presses = 0;
  await screen.findByText('End of step 8');
  while (presses < 12 && document.activeElement !== cardFinish()) {
    await userEvent.keyboard('{ArrowDown}');
    presses += 1;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }
  expect(cardFinish()).toHaveFocus();
  return presses;
}

const titleBarFinish = () =>
  within(screen.getByTestId('title-bar')).getByRole('button', { name: 'Finish review' });

describe('Finish review opens S-05 (F-30.3)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    // The screen is taller than any change, so a ↓ never scrolls a tall change first.
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(4000);
  });

  it('F-30.3 Finish review in the S-04 title bar opens S-05 from a middle step', async () => {
    const { ipc, sessionId } = await selfReview();
    const { router } = await openDetailed(ipc, sessionId, 's4', 'Step 4 / 8');
    await userEvent.click(titleBarFinish());
    await expectSummary(router, sessionId);
  });

  it('F-30.3 Finish review in the S-03 title bar opens S-05 from a middle step', async () => {
    const { ipc, sessionId } = await selfReview();
    const { router } = await openFocus(ipc, sessionId, 's4', 'Step 4 of 8');
    await userEvent.click(titleBarFinish());
    await expectSummary(router, sessionId);
  });

  it('F-30.3 ↓ at the end of the last step of S-04 moves the focus to Finish review, and Enter opens S-05', async () => {
    const { ipc, sessionId } = await selfReview();
    const { router } = await openDetailed(ipc, sessionId, 's8', 'Step 8 / 8');
    const presses = await walkToFinish();
    // First change, the file marks and the pause at the step's end come before the focus moves.
    expect(presses).toBeGreaterThanOrEqual(3);
    expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-04', sessionId }));
    await userEvent.keyboard('{Enter}');
    await expectSummary(router, sessionId, 1);
  });

  it('F-30.3 ↓ opens S-05’s Finish review on the last step of the reader’s order, and the next step on the others', async () => {
    const { ipc, sessionId } = await selfReview();
    await ipc.reviewSetStrategy(sessionId, 'testsFirst');
    // Tests first: s8 is step 1 and s7 (Android) the last step.
    const { router } = await openDetailed(ipc, sessionId, 's8', 'Step 1 / 8');
    for (let n = 0; n < 8 && router.state.location.search !== '?step=s1'; n++) {
      await userEvent.keyboard('{ArrowDown}');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
    }
    expect(await screen.findByText('Step 2 / 8')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?step=s1');

    await act(() => router.navigate(`${pathFor({ screen: 'S-04', sessionId })}?step=s7`));
    expect(await screen.findByText('Step 8 / 8')).toBeInTheDocument();
    await walkToFinish();
    await userEvent.keyboard('{Enter}');
    await expectSummary(router, sessionId, 2);
  });

  it('F-30.3 ↓ with Ctrl or Alt held on the last step stays on step 8 and moves no focus', async () => {
    const { ipc, sessionId } = await selfReview();
    const { router } = await openDetailed(ipc, sessionId, 's8', 'Step 8 / 8');
    await walkToFinish();
    cardFinish().blur();
    await userEvent.keyboard('{Control>}{ArrowDown}{/Control}');
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(cardFinish()).not.toHaveFocus();
    expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-04', sessionId }));
    expect(screen.getByText('Step 8 / 8')).toBeInTheDocument();
  });

  it('F-30.3 ] typed in the Ask box on the last step types into it and stays on step 8', async () => {
    const { ipc, sessionId } = await selfReview();
    const { router } = await openDetailed(ipc, sessionId, 's8', 'Step 8 / 8');
    const ask = screen.getByLabelText('Ask about this step or the selected code');
    await userEvent.type(ask, 'a]');
    expect(ask).toHaveValue('a]');
    expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-04', sessionId }));
    expect(screen.getByText('Step 8 / 8')).toBeInTheDocument();
  });

  it('F-30.3 S-03’s next arrow is enabled on the last step and opens S-05', async () => {
    const { ipc, sessionId } = await selfReview();
    const { router } = await openFocus(ipc, sessionId, 's8', 'Step 8 of 8');
    // The arrow keeps its place and its name on the last step (tests decision).
    const next = screen.getByRole('button', { name: 'Next step' });
    expect(next).toBeEnabled();
    await userEvent.click(next);
    await expectSummary(router, sessionId);
  });

  it('F-30.3 layout B’s toolbar next is enabled on the last step and opens S-05', async () => {
    const { ipc, sessionId } = await selfReview();
    const { router } = await openFocus(ipc, sessionId, 's8', 'Step 8 of 8');
    act(() => {
      useFocusStore.getState().setLayout('B');
    });
    const bar = screen.getByRole('toolbar', { name: 'Step navigation' });
    expect(bar).toHaveTextContent('Step 8 of 8');
    const next = within(bar).getByRole('button', { name: 'Next step' });
    expect(next).toBeEnabled();
    await userEvent.click(next);
    await expectSummary(router, sessionId);
  });
});
