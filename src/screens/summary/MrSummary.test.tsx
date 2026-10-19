import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { Mode } from '../../ipc/types/Mode';
import { useFocusStore } from '../../state/focus';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-12.1: S-05 of an MR session. The heading "SUMMARY", the progress line "All N steps reviewed."
// or "N of M steps reviewed." and Back to steps, in the session's mode. Until F-12.1 an MR session
// showed the empty S-05 stub; a self-review keeps its own summary (SelfReviewSummary.test.tsx).
// The mock plan has 8 steps (the spec's "6" is only an example). The drafts-only session of F-12.7
// has no steps, so no progress line and no Back to steps: that is F-12.7's test, not this one.

const MR_SESSION = 'mock-mr-session-1';
const STEP_IDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
/** Commands that may run Claude or call GitLab; a restored S-05 calls none of them (F-30.4). */
const WORK = /^(review|gitlab|claude(?!Status$|Models$|Activity$))/;

/**
 * An MR session (!482) with `reviewed` steps marked, planned the way the app does it: S-03 reads
 * the plan, so the plan is in the cache when the summary opens.
 */
async function openMrStep4(reviewed: number, mode?: Mode) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  await ipc.reviewPlan(MR_SESSION, () => undefined);
  for (const id of STEP_IDS.slice(0, reviewed)) await ipc.reviewMarkStep(MR_SESSION, id, true);
  if (mode) await ipc.sessionSetMode(MR_SESSION, mode);
  const app = renderApp({ screen: 'S-01' }, ipc);
  const step = mode === 'detailed' ? 'detailed' : 'step';
  await act(() => app.router.navigate(`/session/${MR_SESSION}/${step}?step=s4`));
  expect(await screen.findByText(/^Step 4 (of|\/) 8$/)).toBeInTheDocument();
  return app;
}

/** S-05 of an MR session, opened through the router once the step screen has read the plan. */
async function openMrSummary(reviewed: number, mode?: Mode) {
  const app = await openMrStep4(reviewed, mode);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  return app;
}

const summaryHeading = () => screen.findByRole('heading', { name: /^summary$/i });
const finishReview = () =>
  within(screen.getByTestId('title-bar')).getByRole('button', { name: 'Finish review' });

describe('S-05 summary of an MR session (F-12.1)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the step screens' virtualizers render rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-12.1 SUMMARY, "All 8 steps reviewed." and Back to steps when every step is reviewed', async () => {
    await openMrSummary(8);
    expect(await summaryHeading()).toBeInTheDocument();
    expect(await screen.findByText('All 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to steps' })).toBeInTheDocument();
  });

  it('F-12.1 the progress line says "3 of 8 steps reviewed." when only some steps are reviewed', async () => {
    await openMrSummary(3);
    expect(await screen.findByText('3 of 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.queryByText(/^All \d+ steps reviewed\.$/)).toBeNull();
    expect(await summaryHeading()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to steps' })).toBeInTheDocument();
  });

  it('F-12.1 the progress line counts no step as reviewed when none is: "0 of 8 steps reviewed."', async () => {
    await openMrSummary(0);
    expect(await screen.findByText('0 of 8 steps reviewed.')).toBeInTheDocument();
  });

  it('F-12.1 Finish review in the title bar opens the summary with the steps marked so far', async () => {
    const user = userEvent.setup();
    const { router } = await openMrStep4(2);
    await user.click(finishReview());
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/session/${MR_SESSION}/summary`);
    });
    expect(await summaryHeading()).toBeInTheDocument();
    expect(await screen.findByText('2 of 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to steps' })).toBeInTheDocument();
  });

  it('F-12.1 Back to steps goes back to the step screen (S-03) of a session in Focus mode', async () => {
    const user = userEvent.setup();
    const { router } = await openMrSummary(3, 'focus');
    await user.click(await screen.findByRole('button', { name: 'Back to steps' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/session/${MR_SESSION}/step`);
    });
    expect(await screen.findByText(/^Step \d of 8$/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^summary$/i })).toBeNull();
  });

  it('F-12.1 Back to steps goes back to the detailed step screen (S-04) of a session in Detailed mode', async () => {
    const user = userEvent.setup();
    const { router } = await openMrSummary(3, 'detailed');
    await user.click(await screen.findByRole('button', { name: 'Back to steps' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/session/${MR_SESSION}/detailed`);
    });
    expect(await screen.findByText(/^Step \d \/ 8$/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^summary$/i })).toBeNull();
  });

  it('F-12.1 an MR session has no checklist: no Copy as checklist, no "Nothing to fix."', async () => {
    // The self-review summary stays the self-review's (F-17.4); the MR session does not get it.
    await openMrSummary(3);
    expect(await screen.findByText('3 of 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy as checklist' })).toBeNull();
    expect(screen.queryByText('Nothing to fix.')).toBeNull();
    expect(screen.queryByText('To fix')).toBeNull();
  });
});

// S-05 restored on start (ui.lastRoute) has no plan in the cache: the progress line reads the
// stored plan with its reviewed marks, from stored data only (F-30.4, as the self-review summary).

/** A planned MR session with `reviewed` steps marked, then restored on S-05. */
async function restoreMrSummary(
  reviewed: number,
  planned = true,
  overrides: Partial<IpcClient> = {},
) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  if (planned) {
    await base.reviewPlan(MR_SESSION, () => undefined);
    for (const id of STEP_IDS.slice(0, reviewed)) await base.reviewMarkStep(MR_SESSION, id, true);
  }
  const { client, calls } = recordingClient(base);
  const app = renderApp({ screen: 'S-05', sessionId: MR_SESSION }, { ...client, ...overrides });
  return { ...app, calls };
}

describe('S-05 summary of an MR session restored on start (F-12.1, F-30.4)', () => {
  it('F-12.1 F-30.4 a restored summary shows "3 of 8 steps reviewed." and Back to steps from the stored plan', async () => {
    const { router, calls } = await restoreMrSummary(3);
    expect(router.state.location.state).toEqual({ restored: true });
    expect(await screen.findByText('3 of 8 steps reviewed.')).toBeInTheDocument();
    expect(await summaryHeading()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to steps' })).toBeInTheDocument();
    expect(calls).toContain('sessionResume');
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });

  it('F-12.1 F-30.4 a restored summary shows "All 8 steps reviewed." when every step is reviewed', async () => {
    await restoreMrSummary(8);
    expect(await screen.findByText('All 8 steps reviewed.')).toBeInTheDocument();
  });

  it('F-12.1 F-30.4 a restored summary of a session without a stored plan has no progress line, not "All 0 steps reviewed.", and starts no plan', async () => {
    // Red now because the MR summary reads the stored data on a restore (sessionResume). Once it
    // does, the rest guards: the progress line must not be drawn from an empty plan (the helper
    // says "All 0 steps reviewed." for 0 of 0) and the summary must not start a plan.
    const { calls } = await restoreMrSummary(0, false);
    await waitFor(() => {
      expect(calls).toContain('sessionResume');
    });
    expect(screen.queryByText(/steps? reviewed\.$/)).toBeNull();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});

// Which summary a session gets depends on the MR lookup the title bar already runs (sessionMr):
// null is a self-review. While the lookup is open S-05 draws neither summary (a self-review never
// shows the MR copy first); a failed lookup keeps the MR copy, as S-03 does (useSelfReviewKnown).

describe('S-05 while the session lookup is open or has failed (F-12.1)', () => {
  it('F-12.1 a self-review session is not given the MR summary while its MR lookup is open', async () => {
    // A guard: the S-05 stub passes it too. It fails when the MR summary is the default view of a
    // lookup that has not answered (useSelfReview says "not a self-review" while it is pending).
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    const { sessionId } = await base.sessionOpenLocal({ kind: 'staged' });
    await base.reviewPlan(sessionId, () => undefined);
    let answer: () => void = () => undefined;
    const open = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { client, calls } = recordingClient(base);
    renderApp(
      { screen: 'S-05', sessionId },
      {
        ...client,
        sessionMr: async (id) => {
          await open;
          return base.sessionMr(id);
        },
      },
    );
    await waitFor(() => {
      expect(calls).toContain('sessionsListUnfinished');
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(screen.queryByRole('button', { name: 'Back to steps' })).toBeNull();
    expect(screen.queryByText(/steps? reviewed\.$/)).toBeNull();

    await act(async () => {
      answer();
      await open;
    });
    // The lookup answered: the self-review summary, not the MR one.
    expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to steps' })).toBeInTheDocument();
  });

  it('F-12.1 a failed MR lookup keeps the MR copy: SUMMARY, the progress line and Back to steps', async () => {
    const { calls } = await restoreMrSummary(3, true, {
      sessionMr: () => Promise.reject(new Error('The lookup failed.')),
    });
    expect(await summaryHeading()).toBeInTheDocument();
    expect(await screen.findByText('3 of 8 steps reviewed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to steps' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing to fix.')).toBeNull();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});
