import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import type { ErrorCode } from '../../ipc/types/ErrorCode';
import { useFocusStore, type FocusLayout } from '../../state/focus';
import { mockClient, renderWithIpc } from '../../test/render';
import { renderApp } from '../../test/renderApp';
import { SENTENCE, VM_NAME, VM_PATH, manualFix, proposalOf } from '../../test/fixProposal';
import { StepNotes } from './StepNotes';

// F-25.3 on S-03: More › Fix with Claude (F-25.1) starts the fix of that note (`fixPropose`), and
// the fix card opens under the note card (M7 decision 1): "Claude is editing <name>…" with Cancel
// while Claude works, then "Proposed change · Edited 1 file: <name>" with the diff, the sentence,
// Accept and Discard. A run that edited nothing says "Claude made no change." with Close; a failed
// run (guard violation, usage limit, Claude failed) shows its message with Close. One fix at a
// time (M7 decision 4): while a fix runs or its proposal waits, every Fix with Claude is
// disabled with the tooltip "Finish the open fix first.". The state of a fix belongs to the
// note, not to the card that shows it: it survives a layout switch (F-08.1) and leaving the step
// and coming back, so keep it in a store keyed by the note (`finding.id`), as the answer card does.
// Accept and Discard act in F-25.4, not tested here.
//
// Locators the screen keeps: the menu item "Fix with Claude" in "More for <title>", the card's
// texts and buttons of FixCard.test.tsx, the card after the note's article in document order.

const SESSION = 'mock-mr-session-1';
const NOTES = 's4';
const PENDING = 'PendingCount won’t refresh after upload';
const CAMERA = 'catch (Exception) also catches camera cancellation';
const BUSY = `Claude is editing ${VM_NAME}…`;
const FINISH_FIRST = 'Finish the open fix first.';

const noteOf = (title: string) => screen.findByRole('article', { name: `Claude note: ${title}` });

/** Opens the More menu of a note and returns its Fix with Claude item. */
async function fixItem(title: string) {
  const note = await noteOf(title);
  await userEvent.click(within(note).getByRole('button', { name: 'More' }));
  const head = title.slice(0, 12).replace(/[()]/g, String.raw`\$&`);
  const menu = screen.getByRole('menu', { name: new RegExp(`More for ${head}`) });
  return within(menu).getByRole('menuitem', { name: 'Fix with Claude' });
}

async function startFix(title: string) {
  await userEvent.click(await fixItem(title));
}

function renderNotes(run: ReturnType<typeof manualFix>) {
  return renderWithIpc(
    <StepNotes sessionId={SESSION} stepId={NOTES} selfReview />,
    mockClient({ fixPropose: run.fixPropose, claudeCancel: run.claudeCancel }),
  );
}

describe('S-03 note card: the fix card (F-25.3)', () => {
  it('F-25.3 Fix with Claude starts the fix of that note and shows the busy line with Cancel', async () => {
    const run = manualFix();
    renderNotes(run);
    await startFix(PENDING);
    expect(run.fixPropose).toHaveBeenCalledTimes(1);
    const [target] = run.fixPropose.mock.calls[0] ?? [];
    expect(target).toMatchObject({ sessionId: SESSION, findingId: 'f2' });
    expect((target as { task: string }).task).not.toBe('');
    expect(await screen.findByText(BUSY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.queryByText('Proposed change')).toBeNull();
    // The menu is closed after the click.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('F-25.3 the proposal replaces the busy line: title, file, diff, sentence, Accept and Discard under the note', async () => {
    const run = manualFix();
    const { container } = renderNotes(run);
    await startFix(PENDING);
    await screen.findByText(BUSY);
    await act(() => run.finish(proposalOf()));

    expect(await screen.findByText('Proposed change')).toBeInTheDocument();
    expect(screen.getByText(`Edited 1 file: ${VM_NAME}`)).toBeInTheDocument();
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled();
    expect(screen.queryByText(BUSY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(container.querySelector('[data-kind="add"]')?.textContent).toContain(
      'await RefreshPendingAsync();',
    );
    // It opens under the note card of the note it fixes.
    const note = await noteOf(PENDING);
    const title = screen.getByText('Proposed change');
    expect(note.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('F-25.3 Cancel stops the run with claudeCancel(task); the card goes and no error shows', async () => {
    const run = manualFix();
    renderNotes(run);
    await startFix(PENDING);
    await screen.findByText(BUSY);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    const [target] = run.fixPropose.mock.calls[0] ?? [];
    expect(run.claudeCancel).toHaveBeenCalledTimes(1);
    expect(run.claudeCancel).toHaveBeenCalledWith((target as { task: string }).task);
    expect(screen.queryByText(BUSY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // Fix with Claude is there again.
    expect(await fixItem(PENDING)).toBeEnabled();
  });

  it.each<[ErrorCode, string]>([
    ['CLAUDE_LIMITED', 'Claude usage limit reached'],
    [
      'CLAUDE_GUARD_VIOLATION',
      `Claude changed files other than ${VM_NAME}, so the run was discarded.`,
    ],
    ['CLAUDE_FAILED', 'Claude stopped before it finished.'],
  ])('F-25.3 a failed run (%s) shows its message with Close', async (code, message) => {
    const run = manualFix();
    renderNotes(run);
    await startFix(PENDING);
    await screen.findByText(BUSY);
    await act(() => run.fail(code, message));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(message)).toBeInTheDocument();
    expect(screen.queryByText(BUSY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await fixItem(PENDING)).toBeEnabled();
  });

  it('F-25.3 no edit shows "Claude made no change." with the sentence and Close, and no Accept', async () => {
    const run = manualFix();
    renderNotes(run);
    await startFix(PENDING);
    await screen.findByText(BUSY);
    await act(() =>
      run.finish({ ...proposalOf(VM_PATH, 'The counter already refreshes.'), hunks: [] }),
    );
    expect(await screen.findByText('Claude made no change.')).toBeInTheDocument();
    expect(screen.getByText('The counter already refreshes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Claude made no change.')).toBeNull();
    expect(await fixItem(PENDING)).toBeEnabled();
  });

  it('F-25.3 one fix at a time: while one runs or waits, Fix with Claude of the other note is disabled', async () => {
    const run = manualFix();
    renderNotes(run);
    await startFix(PENDING);
    await screen.findByText(BUSY);
    const other = await fixItem(CAMERA);
    expect(other).toBeDisabled();
    expect(other).toHaveAttribute('title', FINISH_FIRST);
    await userEvent.keyboard('{Escape}');
    // The note being fixed has no second run either.
    const same = await fixItem(PENDING);
    expect(same).toBeDisabled();
    expect(same).toHaveAttribute('title', FINISH_FIRST);
    await userEvent.keyboard('{Escape}');

    await act(() => run.finish(proposalOf()));
    await screen.findByText('Proposed change');
    const waiting = await fixItem(CAMERA);
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveAttribute('title', FINISH_FIRST);
    expect(run.fixPropose).toHaveBeenCalledTimes(1);
  });
});

// The note card is shown by three layouts; the fix of a note must not depend on which one draws
// it. The mock backend's own self-review of the staged changes, as S-01 opens it.
async function openStep(layout: FocusLayout, run: ReturnType<typeof manualFix>) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
  const app = renderApp(
    { screen: 'S-03', sessionId },
    { ...ipc, fixPropose: run.fixPropose, claudeCancel: run.claudeCancel },
  );
  await app.router.navigate(`/session/${sessionId}/step?step=s4`);
  expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  if (layout !== 'A') {
    act(() => {
      useFocusStore.getState().setLayout(layout);
    });
  }
  return { ...app, sessionId };
}

describe('S-03 layouts: the fix of a note (F-25.3)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it.each<[FocusLayout]>([['A'], ['B'], ['C']])(
    'F-25.3 layout %s: Fix with Claude on a self-review note runs and shows the proposal',
    async (layout) => {
      const run = manualFix();
      await openStep(layout, run);
      await startFix(PENDING);
      expect(await screen.findByText(BUSY)).toBeInTheDocument();
      await act(() => run.finish(proposalOf()));
      expect(await screen.findByText('Proposed change')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
      expect(run.fixPropose).toHaveBeenCalledTimes(1);
    },
  );

  it('F-25.3 a layout switch keeps the busy line and then the proposal, and starts no second run', async () => {
    const run = manualFix();
    await openStep('A', run);
    await startFix(PENDING);
    await screen.findByText(BUSY);
    for (const layout of ['B', 'C', 'A'] as const) {
      act(() => {
        useFocusStore.getState().setLayout(layout);
      });
      expect(await screen.findByText(BUSY)).toBeInTheDocument();
    }
    await act(() => run.finish(proposalOf()));
    await screen.findByText('Proposed change');
    for (const layout of ['C', 'B', 'A'] as const) {
      act(() => {
        useFocusStore.getState().setLayout(layout);
      });
      expect(await screen.findByText('Proposed change')).toBeInTheDocument();
      expect(screen.getByText(`Edited 1 file: ${VM_NAME}`)).toBeInTheDocument();
    }
    expect(run.fixPropose).toHaveBeenCalledTimes(1);
  });

  it('F-25.3 leaving the step and coming back shows the open proposal again and the run goes on', async () => {
    const run = manualFix();
    const app = await openStep('A', run);
    await startFix(PENDING);
    await screen.findByText(BUSY);
    await act(() => app.router.navigate(`/session/${app.sessionId}/step?step=s1`));
    expect(await screen.findByText('Step 1 of 8')).toBeInTheDocument();
    // The run finishes while another step is open.
    await act(() => run.finish(proposalOf()));
    await act(() => app.router.navigate(`/session/${app.sessionId}/step?step=s4`));
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    expect(await screen.findByText('Proposed change')).toBeInTheDocument();
    expect(run.fixPropose).toHaveBeenCalledTimes(1);
  });
});
