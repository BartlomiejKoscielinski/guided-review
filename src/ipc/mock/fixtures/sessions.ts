import type { UnfinishedSession } from '../../types/UnfinishedSession';

/**
 * The mock reports no unfinished sessions by default, so the Review tile is dimmed and S-01
 * has no "Pick up where you left off" section (shell e2e and Dock tests rely on it).
 */
export const unfinishedSessions: UnfinishedSession[] = [];

/** Yesterday at `hours:minutes`, local time, seen from `now`. */
function yesterdayAt(now: Date, hours: number, minutes: number): string {
  const day = new Date(now);
  day.setDate(day.getDate() - 1);
  day.setHours(hours, minutes, 0, 0);
  return day.toISOString();
}

/**
 * The "Pick up where you left off" cards of Start.dc.html (F-04.1): !471 with 5 of 9 steps and
 * 3 drafts, and the self-review of chore/compiled-bindings saved yesterday 18:40. For design
 * shots and `dev:mock` through `MOCK_SESSIONS_KEY`.
 */
export function startSessions(now: Date = new Date()): UnfinishedSession[] {
  return [
    {
      id: 'mr-471',
      status: 'reviewing',
      mode: 'focus',
      updatedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
      resume: { screen: 'S-03', sessionId: 'mr-471' },
      source: { kind: 'mr', project: 'mobile/mobile-app', iid: 471 },
      title: 'Signature screen: field validation',
      reviewedSteps: 5,
      totalSteps: 9,
      drafts: 3,
    },
    {
      id: 'self-compiled-bindings',
      status: 'reviewing',
      mode: 'focus',
      updatedAt: yesterdayAt(now, 18, 40),
      resume: { screen: 'S-03', sessionId: 'self-compiled-bindings' },
      source: { kind: 'local', scope: { kind: 'uncommitted' } },
      title: 'chore/compiled-bindings',
      reviewedSteps: 2,
      totalSteps: 6,
      drafts: 0,
    },
  ];
}
