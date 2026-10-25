import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import type { NewDraft } from '../../ipc/types/NewDraft';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// S-05 of a self-review (F-17.4): a session of commits or local changes has no MR, so its summary
// is the drafts list of S-05 without Publish, Threads or the Approval tile: the notes kept to fix,
// Copy as checklist, Back to steps. The mock plan has 8 steps (the spec's "6" is only an example).

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
const KEPT: NewDraft[] = [COUNTER_NOTE, RETRIES_NOTE];
// A comment on the whole change, not on a line (Draft.position is null).
const GENERAL: NewDraft = {
  sessionId: '',
  findingId: null,
  body: RELEASE,
  position: null,
  severity: null,
};

interface Options {
  kind?: 'local' | 'commit';
  /** How many steps (s1, s2, …) are marked reviewed before the summary opens. */
  reviewed?: number;
  notes?: NewDraft[];
}

/**
 * S-05 of a planned self-review session. The plan screen runs first, as in the app (the plan is in
 * the cache by the time Finish review is pressed), then the router goes to the summary.
 */
async function openSummary({ kind = 'local', reviewed = 0, notes = [] }: Options = {}) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const { sessionId } =
    kind === 'local'
      ? await ipc.sessionOpenLocal({ kind: 'staged' })
      : await ipc.sessionOpenCommit({ to: 'a3f9c12' });
  await ipc.reviewPlan(sessionId, () => undefined);
  for (const id of STEP_IDS.slice(0, reviewed)) await ipc.reviewMarkStep(sessionId, id, true);
  for (const note of notes) await ipc.draftsCreate({ ...note, sessionId });
  const app = renderApp({ screen: 'S-01' }, ipc);
  await act(() => app.router.navigate(`/session/${sessionId}/plan`));
  expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
  await act(() => app.router.navigate(`/session/${sessionId}/summary`));
  return { ...app, ipc, sessionId };
}

const summaryHeading = () => screen.findByRole('heading', { name: /^summary$/i });

describe('S-05 self-review summary', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the step screen's virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-17.4 heading SUMMARY, "All 8 steps reviewed." and Back to steps when every step is reviewed', async () => {
    await openSummary({ reviewed: 8, notes: KEPT });
    expect(await summaryHeading()).toBeInTheDocument();
    expect(await screen.findByText('All 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.getByText('Back to steps')).toBeInTheDocument();
  });

  it('F-17.4 the progress line says "4 of 8 steps reviewed." when only some steps are reviewed', async () => {
    await openSummary({ reviewed: 4, notes: KEPT });
    expect(await screen.findByText('4 of 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.queryByText(/^All \d+ steps reviewed\.$/)).toBeNull();
    expect(await summaryHeading()).toBeInTheDocument();
  });

  it('F-17.4 the progress line counts no step as reviewed when none is: "0 of 8 steps reviewed."', async () => {
    await openSummary({ notes: KEPT });
    expect(await screen.findByText('0 of 8 steps reviewed.')).toBeInTheDocument();
  });

  it('F-17.4 Back to steps goes back to the step screen of the session', async () => {
    const user = userEvent.setup();
    const { router, sessionId } = await openSummary({ reviewed: 4, notes: KEPT });
    await user.click(await screen.findByText('Back to steps'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/session/${sessionId}/step`);
    });
  });

  it('F-17.4 lists the notes kept to fix in the order they were made, each with its text and file:line', async () => {
    await openSummary({ reviewed: 4, notes: KEPT });
    const first = await screen.findByText(COUNTER);
    const second = screen.getByText(RETRIES);
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('DeliveryPhotoViewModel.cs:49')).toBeInTheDocument();
    expect(screen.getByText('UploadWorker.cs:71')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to fix.')).toBeNull();
  });

  it('F-17.4 an empty list says "Nothing to fix."', async () => {
    await openSummary({ reviewed: 8 });
    expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
    expect(await screen.findByText('All 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.queryByText(COUNTER)).toBeNull();
  });

  it('F-17.4 Copy as checklist copies one "- [ ]" line per kept note, with file:line when it has one', async () => {
    const user = userEvent.setup();
    await openSummary({ reviewed: 4, notes: [...KEPT, GENERAL] });
    await user.click(await screen.findByRole('button', { name: 'Copy as checklist' }));
    await waitFor(async () => {
      const text = await navigator.clipboard.readText();
      expect(text.trim().split(/\r?\n/)).toEqual([
        `- [ ] ${COUNTER} (DeliveryPhotoViewModel.cs:49)`,
        `- [ ] ${RETRIES} (UploadWorker.cs:71)`,
        `- [ ] ${RELEASE}`,
      ]);
    });
  });

  it('F-17.4 Copy as checklist is disabled while there is nothing to fix', async () => {
    await openSummary({ reviewed: 8 });
    await screen.findByText('Nothing to fix.');
    expect(screen.getByRole('button', { name: 'Copy as checklist' })).toBeDisabled();
  });

  it('F-17.4 no Publish, approve, resolve or reply control, no Threads tab, no Approval tile, no draft checkboxes', async () => {
    await openSummary({ reviewed: 4, notes: KEPT });
    await screen.findByText(COUNTER);
    expect(
      screen.queryByRole('button', {
        // Fix with Claude per kept note arrives in M7 (F-25.1, SelfReviewSummaryFix.test.tsx).
        name: /publish|approve|resolve|reply|reopen/i,
      }),
    ).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByText(/threads/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: /approval/i })).toBeNull();
    // The checkboxes of S-05 select what Publish sends; there is no Publish, nothing to select.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText('Add a summary comment')).toBeNull();
    expect(screen.queryByText(/until you publish them/)).toBeNull();
  });

  it('F-17.4 a session of commits has the same summary', async () => {
    await openSummary({ kind: 'commit', reviewed: 4, notes: KEPT });
    expect(await screen.findByText(COUNTER)).toBeInTheDocument();
    expect(await screen.findByText('4 of 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy as checklist' })).toBeEnabled();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('F-17.4 an MR session keeps the S-05 stub: no checklist, no "Nothing to fix."', async () => {
    // A guard: the stub passes it before the summary exists; it fails if the self-review summary
    // replaced the MR copy.
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const { router } = renderApp({ screen: 'S-01' }, ipc);
    await act(() => router.navigate(`/session/${MR_SESSION}/summary`));
    // The MR summary's tabs show it is drawn; a self-review summary has none.
    expect((await screen.findAllByRole('tab')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Copy as checklist' })).toBeNull();
    expect(screen.queryByText('Nothing to fix.')).toBeNull();
  });
});

// Finish review (M3 decision 9): in a self-review it opens the self-review summary, in an MR
// session the S-05 stub; the MR session's drafts stay local.

/** S-03 on step 4 of a session, the title bar's Finish review in reach. */
async function openStep4(sessionId: string, ipc = createMockClient({ latencyMs: 0 })) {
  const app = renderApp({ screen: 'S-01' }, ipc);
  await act(() => app.router.navigate(`/session/${sessionId}/step?step=s4`));
  expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
  return app;
}

const finishReview = () =>
  within(screen.getByTestId('title-bar')).getByRole('button', { name: 'Finish review' });

describe('Finish review', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-17.4 Finish review in a self-review opens its summary with the notes kept to fix', async () => {
    const user = userEvent.setup();
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
    await ipc.reviewPlan(sessionId, () => undefined);
    await ipc.reviewMarkStep(sessionId, 's1', true);
    await ipc.reviewMarkStep(sessionId, 's2', true);
    await ipc.draftsCreate({ ...COUNTER_NOTE, sessionId });
    const { router } = await openStep4(sessionId, ipc);

    await user.click(finishReview());
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/session/${sessionId}/summary`);
    });
    expect(await screen.findByText(COUNTER)).toBeInTheDocument();
    expect(await screen.findByText('2 of 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy as checklist' })).toBeInTheDocument();
  });

  it('F-17.4 Finish review with no kept note opens a summary that says "Nothing to fix."', async () => {
    const user = userEvent.setup();
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const { sessionId } = await ipc.sessionOpenCommit({ to: 'a3f9c12' });
    await ipc.reviewPlan(sessionId, () => undefined);
    await openStep4(sessionId, ipc);

    await user.click(finishReview());
    expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
    expect(await screen.findByText('0 of 8 steps reviewed.')).toBeInTheDocument();
  });

  it('F-17.4 Finish review in an MR session opens the S-05 stub, not the self-review summary', async () => {
    const user = userEvent.setup();
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const { router } = await openStep4(MR_SESSION, ipc);

    await user.click(finishReview());
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/session/${MR_SESSION}/summary`);
    });
    expect(screen.queryByRole('button', { name: 'Copy as checklist' })).toBeNull();
    expect(screen.queryByText('Nothing to fix.')).toBeNull();
  });
});
