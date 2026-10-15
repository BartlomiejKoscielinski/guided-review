import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-17.2: a self-review has no MR, so its steps show no threads and its plan summarizes none; the
// mock follows the core, which loads threads for MR sessions only (review/step_context.rs).

const MR_SESSION = 'mock-mr-session-1';

/** A commit session and a local-changes session, planned, and the MR session as the control. */
async function sessions() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  const local = await mock.sessionOpenLocal({ kind: 'staged' });
  const commit = await mock.sessionOpenCommit({ to: 'a3f9c12' });
  const plans = {
    local: await mock.reviewPlan(local.sessionId, () => undefined),
    commit: await mock.reviewPlan(commit.sessionId, () => undefined),
    mr: await mock.reviewPlan(MR_SESSION, () => undefined),
  };
  return { mock, plans, local: local.sessionId, commit: commit.sessionId };
}

describe('mock self-review sessions', () => {
  it('F-17.2 no step of a local or commit session holds a thread; the MR session keeps its three', async () => {
    const { mock, plans, local, commit } = await sessions();
    for (const sessionId of [local, commit]) {
      for (const step of plans.local.plan.steps) {
        expect((await mock.reviewStep(sessionId, step.id)).threads).toEqual([]);
      }
    }
    let threads = 0;
    for (const step of plans.mr.plan.steps) {
      threads += (await mock.reviewStep(MR_SESSION, step.id)).threads.length;
    }
    expect(threads).toBe(3);
  });

  it('F-17.2 the plan of a local or commit session has no "Already discussed" text about threads', async () => {
    const { plans } = await sessions();
    expect(plans.local.plan.alreadyDiscussed).toBe('');
    expect(plans.commit.plan.alreadyDiscussed).toBe('');
    expect(plans.mr.plan.alreadyDiscussed).toMatch(/^3 open threads from Paweł S\./);
  });
});
