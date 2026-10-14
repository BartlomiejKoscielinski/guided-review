import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';
import type { PlanView } from '../types/PlanView';
import { MOCK_CACHED_AT } from './plan';
import type { ReviewScenario } from './review';

const SESSION = 'mock-mr-session-1';

const client = (review: ReviewScenario = {}) => createMockClient({ latencyMs: 0, review });

function recorder() {
  const events: ClaudeTaskEvent<PlanView>[] = [];
  return {
    kinds: () => events.map((e) => e.kind),
    push: (e: ClaudeTaskEvent<PlanView>) => events.push(e),
  };
}

describe('mock plan backend', () => {
  it('F-06.2 F-06.3 !482 plan: queued, started, done with the eight steps of the Plan mock', async () => {
    const mock = client();
    const run = recorder();
    const view = await mock.reviewPlan(SESSION, run.push);
    expect(run.kinds()).toEqual(['queued', 'started', 'done']);
    expect(view.cachedAt).toBeUndefined();
    expect(view.plan.steps.map((s) => s.title)).toEqual([
      'Queue contract',
      'SqliteUploadQueue',
      'UploadWorker with retries',
      'ViewModel: queue instead of upload',
      'Offline banner in the view',
      'DI registration and worker start',
      'Android: network state',
      'Queue tests',
    ]);
    expect(view.plan.steps[0]?.reason).toBe(
      'IUploadQueue and PendingUpload. Everything else builds on this.',
    );
    expect(view.stepStats[0]).toEqual({ files: 2, additions: 38, deletions: 0 });
    expect(view.stepStats[3]).toEqual({ files: 1, additions: 18, deletions: 9 });
    expect(view.skimStats[0]?.files).toBe(5);
    expect(view.plan.coverage).toEqual({ files: 16, filesTotal: 16, hunks: 31, hunksTotal: 31 });
    expect(view.order).toEqual({
      strategy: 'contractToUi',
      custom: false,
      order: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],
    });
  });

  it('F-06.12 opened again: queued, done from the cache with its age', async () => {
    const mock = client();
    await mock.reviewPlan(SESSION, () => undefined);
    const again = recorder();
    const view = await mock.reviewPlan(SESSION, again.push);
    expect(again.kinds()).toEqual(['queued', 'done']);
    expect(view.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('F-06.12 planCached: the first plan already comes from the cache', async () => {
    const run = recorder();
    const view = await client({ planCached: true }).reviewPlan(SESSION, run.push);
    expect(run.kinds()).toEqual(['queued', 'done']);
    expect(view.cachedAt).toBe(MOCK_CACHED_AT);
  });

  it('F-06.4 planFails: the file-order fallback, one step per layer group in GitLab order', async () => {
    const mock = client({ planFails: true });
    const run = recorder();
    const view = await mock.reviewPlan(SESSION, run.push);
    expect(run.kinds()).toEqual(['queued', 'started', 'done']);
    expect(view.fallback).toMatchObject({ code: 'CLAUDE_FAILED', retryable: true });
    expect(view.plan.steps.map((s) => s.title)).toEqual([
      'App',
      'Platforms',
      'Resources',
      'XAML',
      'Build',
      'Core',
      'Infrastructure',
      'Tests',
    ]);
    expect(view.plan.steps[0]?.reason).toBe(
      'PendingCountConverter.cs, PhotoUploadService.cs, DeliveryPhotoViewModel.cs',
    );
    expect(view.order).toMatchObject({ strategy: 'fileOrder', custom: false });
    expect(view.plan.coverage).toEqual({ files: 16, filesTotal: 16, hunks: 18, hunksTotal: 18 });
    expect(view.plan.alreadyDiscussed).toBe('3 open threads.');
    // Never cached: Retry runs Claude again.
    const again = recorder();
    await mock.reviewPlan(SESSION, again.push);
    expect(again.kinds()).toEqual(['queued', 'started', 'done']);
  });

  it('F-06.4 strategies reorder without Claude; refused before the plan', async () => {
    const mock = client();
    await expect(mock.reviewSetStrategy(SESSION, 'testsFirst')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: "The plan isn't ready yet.",
    });
    await mock.reviewPlan(SESSION, () => undefined);
    expect((await mock.reviewSetStrategy(SESSION, 'testsFirst')).order[0]).toBe('s8');
    const files = await mock.reviewSetStrategy(SESSION, 'fileOrder');
    expect(files).toMatchObject({ strategy: 'fileOrder', custom: false });
    expect((await mock.reviewPlan(SESSION, () => undefined)).order).toEqual(files);
  });

  it('F-07.2 Mark reviewed and its undo; the plan and the step show the reviewed steps', async () => {
    const mock = client();
    await expect(mock.reviewMarkStep(SESSION, 's1', true)).rejects.toMatchObject({
      message: "The plan isn't ready yet.",
    });
    const view = await mock.reviewPlan(SESSION, () => undefined);
    expect(view.reviewed).toEqual([]);
    const [s1, s2, s3] = view.plan.steps.map((s) => s.id);
    if (s1 === undefined || s2 === undefined || s3 === undefined) throw new Error('no steps');
    expect(await mock.reviewMarkStep(SESSION, s3, true)).toEqual([s3]);
    expect(await mock.reviewMarkStep(SESSION, s1, true)).toEqual([s1, s3]);
    expect(await mock.reviewMarkStep(SESSION, s3, false)).toEqual([s1]);
    expect((await mock.reviewStep(SESSION, s1)).reviewed).toBe(true);
    expect((await mock.reviewStep(SESSION, s2)).reviewed).toBe(false);
    expect((await mock.reviewPlan(SESSION, () => undefined)).reviewed).toEqual([s1]);
    await expect(mock.reviewMarkStep(SESSION, 'nope', true)).rejects.toMatchObject({
      message: 'The step is not in the plan.',
    });
  });

  it('F-06.5 a dragged order is kept until a strategy is picked; bad orders are refused', async () => {
    const mock = client();
    await mock.reviewPlan(SESSION, () => undefined);
    const dragged = ['s2', 's1', 's3', 's4', 's5', 's6', 's7', 's8'];
    expect(await mock.reviewReorderSteps(SESSION, dragged)).toEqual({
      strategy: 'contractToUi',
      custom: true,
      order: dragged,
    });
    expect((await mock.reviewPlan(SESSION, () => undefined)).order.order).toEqual(dragged);
    await expect(mock.reviewReorderSteps(SESSION, ['s1', 's2'])).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: "The order doesn't match the plan's steps.",
    });
    const reset = await mock.reviewSetStrategy(SESSION, 'contractToUi');
    expect(reset.custom).toBe(false);
    expect(reset.order[0]).toBe('s1');
  });
});
