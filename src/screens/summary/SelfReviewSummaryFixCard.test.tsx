import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import type { Draft } from '../../ipc/types/Draft';
import type { NewDraft } from '../../ipc/types/NewDraft';
import { useFocusStore } from '../../state/focus';
import { SENTENCE, manualFix, proposalOf } from '../../test/fixProposal';
import { renderApp } from '../../test/renderApp';

// F-25.3 on S-05 of a self-review: Fix with Claude on a note kept to fix (F-25.1) starts the fix
// of that draft (`fixPropose` with `{ task, sessionId, draftId }`), and the fix card opens under
// the item (M7 decision 1): the busy line "Claude is editing <name>…" with Cancel, then
// "Proposed change · Edited 1 file: <name>" with the diff, the sentence, Accept and Discard.
// One fix at a time (M7 decision 4): every other Fix with Claude is disabled with the tooltip
// "Finish the open fix first." while a fix runs or its proposal waits. The card state belongs to
// the draft (kept in a store keyed by the draft id), so it survives leaving S-05 and coming back.
// Accept and Discard act in F-25.4, not tested here.
//
// Locators the screen keeps: each kept note a list item, its button named exactly "Fix with
// Claude", the card after that item's text and before the next item's text in document order.

const STEP_IDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
const COUNTER = 'Refresh PendingCount after each upload';
const RETRIES = 'Cap the retries in UploadWorker';
const COUNTER_NOTE: NewDraft = {
  sessionId: '',
  findingId: null,
  body: COUNTER,
  position: { file: 'DeliveryPhotoViewModel.cs', side: 'new', line: 49 },
  severity: 'fix',
};
const RETRIES_NOTE: NewDraft = {
  sessionId: '',
  findingId: null,
  body: RETRIES,
  position: { file: 'UploadWorker.cs', side: 'new', line: 71 },
  severity: 'nit',
};
const BUSY = 'Claude is editing DeliveryPhotoViewModel.cs…';
const FINISH_FIRST = 'Finish the open fix first.';

/** S-05 of a planned, fully reviewed local self-review with both notes kept to fix. */
async function openSummary(run: ReturnType<typeof manualFix>) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
  await ipc.reviewPlan(sessionId, () => undefined);
  for (const id of STEP_IDS) await ipc.reviewMarkStep(sessionId, id, true);
  const drafts: Draft[] = [];
  for (const note of [COUNTER_NOTE, RETRIES_NOTE])
    drafts.push(await ipc.draftsCreate({ ...note, sessionId }));
  const app = renderApp(
    { screen: 'S-01' },
    { ...ipc, fixPropose: run.fixPropose, claudeCancel: run.claudeCancel },
  );
  await act(() => app.router.navigate(`/session/${sessionId}/plan`));
  expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
  await act(() => app.router.navigate(`/session/${sessionId}/summary`));
  expect(await screen.findByRole('heading', { name: /^summary$/i })).toBeInTheDocument();
  return { ...app, sessionId, drafts };
}

async function rowOf(text: string): Promise<HTMLElement> {
  const row = (await screen.findByText(text)).closest('li');
  if (!row) throw new Error(`The note "${text}" is not in a list item.`);
  return row;
}

const fixButton = (row: HTMLElement) =>
  within(row).getByRole('button', { name: 'Fix with Claude' });

describe('S-05 self-review summary: the fix card (F-25.3)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-25.3 Fix with Claude on a kept note starts the fix of that draft and shows the busy line with Cancel', async () => {
    const run = manualFix();
    const { sessionId, drafts } = await openSummary(run);
    await userEvent.click(fixButton(await rowOf(COUNTER)));
    expect(run.fixPropose).toHaveBeenCalledTimes(1);
    const [target] = run.fixPropose.mock.calls[0] ?? [];
    expect(target).toMatchObject({ sessionId, draftId: drafts[0]?.id });
    expect((target as { task: string }).task).not.toBe('');
    expect(await screen.findByText(BUSY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('F-25.3 the proposal opens under that item: title, file, diff, sentence, Accept and Discard', async () => {
    const run = manualFix();
    await openSummary(run);
    await userEvent.click(fixButton(await rowOf(COUNTER)));
    await screen.findByText(BUSY);
    await act(() => run.finish(proposalOf()));

    const title = await screen.findByText('Proposed change');
    expect(screen.getByText('Edited 1 file: DeliveryPhotoViewModel.cs')).toBeInTheDocument();
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled();
    expect(document.body.querySelector('[data-kind="del"]')?.textContent).toContain(
      'PendingCount = await _queue.CountAsync();',
    );
    // After the item it belongs to and before the next item.
    const here = await screen.findByText(COUNTER);
    const next = await screen.findByText(RETRIES);
    expect(here.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('F-25.3 one fix at a time: the other kept note’s button is disabled with the tooltip, while it runs and while the proposal waits', async () => {
    const run = manualFix();
    await openSummary(run);
    await userEvent.click(fixButton(await rowOf(COUNTER)));
    await screen.findByText(BUSY);
    const other = fixButton(await rowOf(RETRIES));
    expect(other).toBeDisabled();
    expect(other).toHaveAttribute('title', FINISH_FIRST);
    await act(() => run.finish(proposalOf()));
    await screen.findByText('Proposed change');
    expect(fixButton(await rowOf(RETRIES))).toBeDisabled();
    expect(fixButton(await rowOf(RETRIES))).toHaveAttribute('title', FINISH_FIRST);
    expect(run.fixPropose).toHaveBeenCalledTimes(1);
  });

  it('F-25.3 Cancel ends the run with claudeCancel(task), and both buttons are usable again', async () => {
    const run = manualFix();
    await openSummary(run);
    await userEvent.click(fixButton(await rowOf(COUNTER)));
    await screen.findByText(BUSY);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    const [target] = run.fixPropose.mock.calls[0] ?? [];
    expect(run.claudeCancel).toHaveBeenCalledWith((target as { task: string }).task);
    expect(screen.queryByText(BUSY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fixButton(await rowOf(COUNTER))).toBeEnabled();
    expect(fixButton(await rowOf(RETRIES))).toBeEnabled();
  });

  it('F-25.3 a usage limit shows its message as an alert in place of the card, with Close', async () => {
    const run = manualFix();
    await openSummary(run);
    await userEvent.click(fixButton(await rowOf(COUNTER)));
    await screen.findByText(BUSY);
    await act(() => run.fail('CLAUDE_LIMITED', 'Claude usage limit reached'));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Claude usage limit reached')).toBeInTheDocument();
    // The card holding the alert; the title bar has its own Close caption button.
    const card = alert.parentElement as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fixButton(await rowOf(COUNTER))).toBeEnabled();
  });

  it('F-25.3 leaving S-05 and coming back shows the open proposal again, with no second run', async () => {
    const run = manualFix();
    const { router, sessionId } = await openSummary(run);
    await userEvent.click(fixButton(await rowOf(COUNTER)));
    await screen.findByText(BUSY);
    await act(() => router.navigate(`/session/${sessionId}/plan`));
    expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
    await act(() => run.finish(proposalOf()));
    await act(() => router.navigate(`/session/${sessionId}/summary`));
    expect(await screen.findByText('Proposed change')).toBeInTheDocument();
    expect(run.fixPropose).toHaveBeenCalledTimes(1);
  });
});
