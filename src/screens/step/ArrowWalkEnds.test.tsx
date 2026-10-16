import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathFor } from '../../app/routes';
import { renderApp } from '../../test/renderApp';
import {
  SESSION,
  down,
  noteInThirdHunk,
  expectCurrentLine,
  expectStepReviewed,
  mockLayout,
  openFocus,
  press,
  selfReview,
  VM,
} from '../../test/walk';

// F-30.6 on S-03, the ends of the walk and the keys that act at the current change (M4 decisions
// 14 and 15): at the end of the last step `↓` moves the focus to Finish review (Enter or Space
// opens S-05), and D and X act on the note of the current change, else on the focused one.

/** Lets pending key effects run before checking that nothing changed. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

const finishReview = () =>
  within(screen.getByTestId('title-bar')).getByRole('button', { name: 'Finish review' });

/** Walks the last step of the review with ↓ until the focus is on Finish review. */
async function walkToTheEnd() {
  const { ipc, sessionId } = await selfReview();
  const app = renderApp({ screen: 'S-01' }, ipc);
  await act(() => app.router.navigate(`${pathFor({ screen: 'S-03', sessionId })}?step=s8`));
  expect(await screen.findByText('Step 8 of 8', { selector: 'span' })).toBeInTheDocument();
  let presses = 0;
  while (presses < 12 && document.activeElement !== finishReview()) {
    await down();
    presses += 1;
    await settle();
    // Until the focus moves, the walk stays on the last step.
    if (document.activeElement !== finishReview()) {
      expect(app.router.state.location.pathname).toBe(pathFor({ screen: 'S-03', sessionId }));
    }
  }
  return { app, sessionId, presses };
}

async function expectSummary(router: ReturnType<typeof renderApp>['router'], sessionId: string) {
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-05', sessionId }));
  });
  expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
  // The walk marked the last step; Enter or Space on the button did not toggle its last file back.
  expect(await screen.findByText('1 of 8 steps reviewed.')).toBeInTheDocument();
}

describe('S-03 the ends of the walk and the keys at the current change (F-30.6)', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = mockLayout();
  });

  afterEach(() => {
    restore();
  });

  it('F-30.6 at the end of the last step ↓ moves the focus to Finish review, after the pause; Enter opens S-05', async () => {
    const { app, sessionId, presses } = await walkToTheEnd();
    expect(finishReview()).toHaveFocus();
    // First change, then the file marks and the step pauses reviewed, then the focus moves.
    expect(presses).toBeGreaterThanOrEqual(3);
    await expectStepReviewed(true);
    await press('{Enter}');
    await expectSummary(app.router, sessionId);
  });

  it('F-30.6 Space on the focused Finish review opens S-05 and does not toggle the last file’s mark', async () => {
    const { app, sessionId } = await walkToTheEnd();
    expect(finishReview()).toHaveFocus();
    await press(' ');
    await expectSummary(app.router, sessionId);
  });

  it('F-30.6 D acts on the note of the current change, not the focused one', async () => {
    const { calls } = await openFocus('s4', { wrap: noteInThirdHunk });
    // The step opens on its first Should fix, f2, in the second hunk.
    await down();
    await down();
    await down();
    await expectCurrentLine(VM, 61);
    await press('d');
    await waitFor(() => {
      expect(calls.decide).toEqual([[SESSION, 'f4', { kind: 'addToDrafts' }]]);
    });
  });

  it('F-30.6 X acts on the note of the current change', async () => {
    const { calls } = await openFocus('s4', { wrap: noteInThirdHunk });
    await down();
    await down();
    await down();
    await expectCurrentLine(VM, 61);
    await press('x');
    await waitFor(() => {
      expect(calls.decide).toEqual([[SESSION, 'f4', { kind: 'dismiss' }]]);
    });
  });

  it('F-30.6 D and X act on the focused note when the current change has none', async () => {
    const { calls } = await openFocus('s4', { wrap: noteInThirdHunk });
    // The first stop of step 4 is the closed fold of the first hunk: no note there.
    await down();
    await waitFor(() => {
      expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    });
    await press('x');
    await waitFor(() => {
      expect(calls.decide).toEqual([[SESSION, 'f2', { kind: 'dismiss' }]]);
    });
  });
});
