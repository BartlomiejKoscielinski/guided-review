import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-17.4 and F-30.4: S-05 of a self-review opened by the restore on start (ui.lastRoute) has no
// plan in the cache, so its progress line reads the stored plan with its reviewed marks, from
// stored data only: no Claude run, no GitLab call.

const STEP_IDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
/** Commands that may run Claude or call GitLab. */
const WORK = /^(review|gitlab|claude(?!Status$|Models$))/;

/** A planned self-review session (staged changes) with `reviewed` steps marked, then restored on S-05. */
async function restoreSummary(reviewed: number, planned = true) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const { sessionId } = await base.sessionOpenLocal({ kind: 'staged' });
  if (planned) {
    await base.reviewPlan(sessionId, () => undefined);
    for (const id of STEP_IDS.slice(0, reviewed)) await base.reviewMarkStep(sessionId, id, true);
  }
  const { client, calls } = recordingClient(base);
  const app = renderApp({ screen: 'S-05', sessionId }, client);
  return { ...app, calls, sessionId };
}

describe('S-05 self-review summary restored on start (F-17.4, F-30.4)', () => {
  it('F-17.4 F-30.4 a restored summary shows "3 of 8 steps reviewed." from the stored plan', async () => {
    const { router, calls } = await restoreSummary(3);
    expect(router.state.location.state).toEqual({ restored: true });
    expect(await screen.findByText('3 of 8 steps reviewed.')).toBeInTheDocument();
    expect(calls).toContain('sessionResume');
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });

  it('F-17.4 F-30.4 a restored summary shows "All 8 steps reviewed." when every step is reviewed', async () => {
    await restoreSummary(8);
    expect(await screen.findByText('All 8 steps reviewed.')).toBeInTheDocument();
  });

  it('F-17.4 F-30.4 a restored summary of a session without a stored plan shows no progress line and starts no plan', async () => {
    const { calls } = await restoreSummary(0, false);
    expect(await screen.findByText('Nothing to fix.')).toBeInTheDocument();
    await waitFor(() => {
      expect(calls).toContain('sessionResume');
    });
    expect(screen.queryByText(/steps reviewed\.$/)).toBeNull();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});
