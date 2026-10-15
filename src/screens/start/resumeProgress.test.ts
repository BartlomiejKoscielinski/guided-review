import { describe, expect, it } from 'vitest';
import type { UnfinishedSession } from '../../ipc/types/UnfinishedSession';
import { progressLine, sourceTag } from './resumeProgress';

const NOW = new Date(2026, 9, 14, 20, 0);

const session = (patch: Partial<UnfinishedSession>): UnfinishedSession => ({
  id: 's1',
  status: 'reviewing',
  mode: 'focus',
  updatedAt: new Date(2026, 9, 13, 18, 40).toISOString(),
  resume: { screen: 'S-03', sessionId: 's1' },
  source: { kind: 'mr', project: 'mobile/mobile-app', iid: 482 },
  title: 'Offline queue for delivery photos',
  reviewedSteps: 0,
  totalSteps: 4,
  drafts: 0,
  ...patch,
});

describe('resume card progress', () => {
  it('F-04.1 one draft and one step read in the singular', () => {
    expect(progressLine(session({ drafts: 1 }), NOW)).toBe('0 of 4 steps · 1 draft');
    expect(progressLine(session({ totalSteps: 1, drafts: 2 }), NOW)).toBe('0 of 1 step · 2 drafts');
  });

  it('F-04.1 a commit card has its own tag and says when it was saved', () => {
    const commit = session({ source: { kind: 'commits', to: 'a3f9c12' }, reviewedSteps: 1 });
    expect(sourceTag(commit.source)).toBe('commit');
    expect(progressLine(commit, NOW)).toBe('1 of 4 steps · saved yesterday 18:40');
  });
});
