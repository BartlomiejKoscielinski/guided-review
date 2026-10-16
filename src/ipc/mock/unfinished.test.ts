import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// The mock lists the sessions opened in it as the core lists its sessions (F-04.1, F-30.2), so the
// Review tile lights up after a review starts (F-19.1's e2e goes back to the step through it).

const ignore = () => undefined;

describe('mock unfinished sessions (F-04.1, F-30.2)', () => {
  it('F-30.2 a session opened in the mock is listed with its source, title and progress', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    expect(await ipc.sessionsListUnfinished()).toEqual([]);

    const mr = await ipc.sessionOpenMr(482, null, 'task', ignore);
    const commit = await ipc.sessionOpenCommit({ from: '51c2e8a', to: '9be0d47' });
    const listed = await ipc.sessionsListUnfinished();

    expect(listed.map((s) => s.id).sort()).toEqual([mr.sessionId, commit.sessionId].sort());
    const mrCard = listed.find((s) => s.id === mr.sessionId);
    expect(mrCard).toMatchObject({
      status: 'planning',
      mode: 'focus',
      source: { kind: 'mr', iid: 482 },
      title: 'Offline queue for delivery photos',
      reviewedSteps: 0,
      totalSteps: 0,
      drafts: 0,
      // Not planned yet: the plan is where it resumes.
      resume: { screen: 'S-02', sessionId: mr.sessionId },
    });
    expect(listed.find((s) => s.id === commit.sessionId)?.title).toBe('51c2e8a..9be0d47');
  });

  it('F-30.2 a planned session resumes at step review in its mode, or at its own last screen', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    const { sessionId } = await ipc.sessionOpenMr(482, null, 'task', ignore);
    await ipc.reviewPlan(sessionId, ignore);

    // The last screen belongs to another place (Settings): status and mode decide.
    await ipc.appSettingsSet({ ui: { lastRoute: { screen: 'S-07', section: 'general' } } });
    const [planned] = await ipc.sessionsListUnfinished();
    expect(planned).toMatchObject({
      status: 'reviewing',
      totalSteps: 8,
      resume: { screen: 'S-03', sessionId },
    });

    await ipc.sessionSetMode(sessionId, 'detailed');
    expect((await ipc.sessionsListUnfinished())[0]?.resume).toEqual({ screen: 'S-04', sessionId });

    // The session's own last screen wins.
    const summary = { screen: 'S-05', sessionId } as const;
    await ipc.appSettingsSet({ ui: { lastRoute: summary } });
    expect((await ipc.sessionsListUnfinished())[0]?.resume).toEqual(summary);
  });

  it('F-04.1 seeded sessions follow the opened ones', async () => {
    const seeded = { id: 'seeded', title: 'Seeded' };
    const ipc = createMockClient({
      latencyMs: 0,
      sessions: [
        {
          ...seeded,
          status: 'reviewing',
          mode: 'focus',
          updatedAt: '2026-10-15T16:40:00Z',
          resume: { screen: 'S-03', sessionId: 'seeded' },
          source: { kind: 'mr', project: 'mobile/courier-app', iid: 475 },
          reviewedSteps: 1,
          totalSteps: 4,
          drafts: 0,
        },
      ],
    });
    const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
    expect((await ipc.sessionsListUnfinished()).map((s) => s.id)).toEqual([sessionId, 'seeded']);
  });
});
