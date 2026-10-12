import { describe, expect, it } from 'vitest';
import type { Preparation } from '../../state/start';
import { stageLines } from './stages';

const base: Preparation = { task: 't', iid: 482, title: 'T', progress: null, outcome: null };

describe('stageLines', () => {
  it('F-05.6 marks done, current and pending stages and the file count', () => {
    expect(stageLines({ ...base, progress: { stage: 'fetching', iid: 482, title: 'T' } })).toEqual([
      { label: 'Fetching !482', state: 'current' },
      { label: 'Creating worktree', state: 'pending' },
      { label: 'Computing diff', state: 'pending' },
    ]);
    expect(
      stageLines({ ...base, progress: { stage: 'computingDiff', files: 1 } }).map((l) => l.label),
    ).toEqual(['Fetching !482', 'Creating worktree', 'Computing diff · 1 file']);
  });

  it('F-05.6 a failure marks the current stage; an opened session marks all done', () => {
    const failed = stageLines({
      ...base,
      progress: { stage: 'creatingWorktree' },
      outcome: { kind: 'failed', message: 'x' },
    });
    expect(failed.map((l) => l.state)).toEqual(['done', 'failed', 'pending']);
    const opened = stageLines({
      ...base,
      progress: { stage: 'computingDiff', files: 16 },
      outcome: { kind: 'opened', route: { screen: 'S-02', sessionId: 's' } },
    });
    expect(opened.map((l) => l.state)).toEqual(['done', 'done', 'done']);
  });
});
