import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { AnalysisStatus } from '../types/AnalysisStatus';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';
import type { StepAnalysis } from '../types/StepAnalysis';

// F-08.8: `reviewAnalysisStatus` of the mock backend, as the core's `review_analysis_status`
// (src-tauri/tests/it/analysis_status.rs): the session's steps whose analysis is ready, running now
// or failed, and the code Claude reads. The MR session's worktree is at a3f9c12, the sha the
// footer of Main.dc.html shows ("worktree @ a3f9c12").

const MR_SESSION = 'mock-mr-session-1';

const shaOf = (codeAt: AnalysisStatus['codeAt']) => ('sha' in codeAt ? codeAt.sha : null);

describe('mock review analysis status (F-08.8)', () => {
  it('F-08.8 the MR session reads the review worktree at a3f9c12, as Main.dc.html shows', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.reviewPlan(MR_SESSION, () => undefined);
    const { codeAt } = await mock.reviewAnalysisStatus(MR_SESSION);
    expect(codeAt.kind).toBe('worktree');
    expect(shaOf(codeAt)).toMatch(/^a3f9c12[0-9a-f]{33}$/);
  });

  it('F-08.8 a commit self-review reads the repository at its head; local changes the working tree', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.repoPick();
    const commit = await mock.sessionOpenCommit({ to: 'a3f9c12' });
    const local = await mock.sessionOpenLocal({ kind: 'staged' });
    await mock.reviewPlan(commit.sessionId, () => undefined);
    await mock.reviewPlan(local.sessionId, () => undefined);
    const atCommit = (await mock.reviewAnalysisStatus(commit.sessionId)).codeAt;
    expect(atCommit.kind).toBe('repository');
    expect(shaOf(atCommit)).toMatch(/^a3f9c12[0-9a-f]{33}$/);
    expect((await mock.reviewAnalysisStatus(local.sessionId)).codeAt).toEqual({
      kind: 'workingTree',
    });
  });

  it('F-08.8 nothing analyzed yet: no step is ready, running or failed', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.reviewPlan(MR_SESSION, () => undefined);
    const status = await mock.reviewAnalysisStatus(MR_SESSION);
    expect(status.ready).toEqual([]);
    expect(status.running).toEqual([]);
    expect(status.failed).toEqual([]);
  });

  it('F-08.8 a step the mock analyzed is ready and nothing runs afterwards', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.reviewPlan(MR_SESSION, () => undefined);
    await mock.reviewFindings(MR_SESSION, 's4', () => undefined);
    const status = await mock.reviewAnalysisStatus(MR_SESSION);
    expect(status.ready).toContain('s4');
    expect(status.running).not.toContain('s4');
    expect(status.failed).toEqual([]);
  });

  it('F-08.8 a step whose task fails is failed, not ready', async () => {
    const mock = createMockClient({ latencyMs: 0, review: { stepFails: true } });
    await mock.reviewPlan(MR_SESSION, () => undefined);
    await expect(mock.reviewFindings(MR_SESSION, 's4', () => undefined)).rejects.toThrow();
    const status = await mock.reviewAnalysisStatus(MR_SESSION);
    expect(status.failed).toContain('s4');
    expect(status.ready).not.toContain('s4');
    expect(status.running).not.toContain('s4');
  });

  it('F-08.8 while the step task runs, its step is running', async () => {
    const mock = createMockClient({ latencyMs: 5 });
    await mock.reviewPlan(MR_SESSION, () => undefined);
    let started!: () => void;
    const startedEvent = new Promise<void>((resolve) => {
      started = resolve;
    });
    const run = mock.reviewFindings(MR_SESSION, 's4', (event: ClaudeTaskEvent<StepAnalysis>) => {
      if (event.kind === 'started') started();
    });
    await startedEvent;
    const during = await mock.reviewAnalysisStatus(MR_SESSION);
    expect(during.running).toContain('s4');
    expect(during.ready).not.toContain('s4');
    await run;
    const after = await mock.reviewAnalysisStatus(MR_SESSION);
    expect(after.running).not.toContain('s4');
    expect(after.ready).toContain('s4');
  });
});
