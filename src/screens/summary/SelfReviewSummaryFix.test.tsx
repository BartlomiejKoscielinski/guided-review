import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import type { NewDraft } from '../../ipc/types/NewDraft';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-25.1: Fix with Claude is offered on own code only. On S-05 of a self-review (commits or local
// changes) every note kept to fix that points at a file has a "Fix with Claude" button (M7
// decision 1; F-17.4 already promises it). A kept note without a file (a comment on the whole
// change) has none, because a fix edits the one file the note points at (F-25.2). A teammate's MR
// summary never shows it. Clicking it starts the fix flow of F-25.2 and F-25.3, not tested here.
//
// Locators the screen keeps: each kept note stays one list item (role listitem) of the "To fix"
// section; its button is a plain button named exactly "Fix with Claude".

const MR_SESSION = 'mock-mr-session-1';
const STEP_IDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

const COUNTER = 'Refresh PendingCount after each upload';
const RETRIES = 'Cap the retries in UploadWorker';
const RELEASE = 'Check the release notes';
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
// A comment on the whole change, not on a line (Draft.position is null).
const GENERAL: NewDraft = {
  sessionId: '',
  findingId: null,
  body: RELEASE,
  position: null,
  severity: null,
};

type Kind = 'local' | 'commit' | 'mr';

/** S-05 of a planned session of the given kind with `notes` kept (drafts for an MR session). */
async function openSummary(kind: Kind, notes: NewDraft[]) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const sessionId =
    kind === 'mr'
      ? MR_SESSION
      : (kind === 'local'
          ? await ipc.sessionOpenLocal({ kind: 'staged' })
          : await ipc.sessionOpenCommit({ to: 'a3f9c12' })
        ).sessionId;
  await ipc.reviewPlan(sessionId, () => undefined);
  for (const id of STEP_IDS) await ipc.reviewMarkStep(sessionId, id, true);
  for (const note of notes) await ipc.draftsCreate({ ...note, sessionId });
  const app = renderApp({ screen: 'S-01' }, ipc);
  await act(() => app.router.navigate(`/session/${sessionId}/plan`));
  expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
  await act(() => app.router.navigate(`/session/${sessionId}/summary`));
  expect(await screen.findByRole('heading', { name: /^summary$/i })).toBeInTheDocument();
  return { ...app, ipc, sessionId };
}

/** The list item of the kept note with this text. */
async function rowOf(text: string): Promise<HTMLElement> {
  const row = (await screen.findByText(text)).closest('li');
  if (!row) throw new Error(`The note "${text}" is not in a list item.`);
  return row;
}

const fixButton = (row: HTMLElement) =>
  within(row).queryByRole('button', { name: 'Fix with Claude' });

describe('S-05 self-review summary: Fix with Claude (F-25.1)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-25.1 every kept note of a local self-review with a file has its own enabled Fix with Claude', async () => {
    await openSummary('local', [COUNTER_NOTE, RETRIES_NOTE]);
    for (const text of [COUNTER, RETRIES]) {
      const button = fixButton(await rowOf(text));
      expect(button).not.toBeNull();
      expect(button).toBeEnabled();
    }
    expect(screen.getAllByRole('button', { name: 'Fix with Claude' })).toHaveLength(2);
  });

  it('F-25.1 a review of commits is a self-review too: its kept notes offer Fix with Claude', async () => {
    await openSummary('commit', [COUNTER_NOTE]);
    expect(fixButton(await rowOf(COUNTER))).toBeEnabled();
  });

  it('F-25.1 a kept note without a file (a comment on the whole change) has no Fix with Claude, its neighbours keep theirs', async () => {
    await openSummary('local', [COUNTER_NOTE, GENERAL]);
    const general = await rowOf(RELEASE);
    expect(fixButton(general)).toBeNull();
    expect(fixButton(await rowOf(COUNTER))).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Fix with Claude' })).toHaveLength(1);
  });

  it('F-25.1 an empty list ("Nothing to fix.") shows no Fix with Claude', async () => {
    await openSummary('local', []);
    expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
  });

  it('F-25.1 the summary of a teammate’s MR never offers Fix with Claude, on its drafts', async () => {
    await openSummary('mr', [COUNTER_NOTE, RETRIES_NOTE]);
    // The MR summary lists the drafts; they are there, the button is not.
    expect(await screen.findByText(COUNTER)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fix with claude/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /fix with claude/i })).toBeNull();
  });
});
