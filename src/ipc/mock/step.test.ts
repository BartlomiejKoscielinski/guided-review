import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { ReviewScenario } from './review';

const SESSION = 'mock-mr-session-1';
const QUEUE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';

const planned = async (review: ReviewScenario = {}) => {
  const mock = createMockClient({ latencyMs: 0, review });
  await mock.reviewPlan(SESSION, () => undefined);
  return mock;
};

describe('mock step backend', () => {
  it('F-07.2 step header: STEP n OF m, title, description, prev and next in the order', async () => {
    const mock = await planned();
    const view = await mock.reviewStep(SESSION, 's2');
    expect([view.number, view.total]).toEqual([2, 8]);
    expect(view.step.title).toBe('SqliteUploadQueue');
    expect(view.step.description).not.toBe('');
    expect([view.prev, view.next]).toEqual(['s1', 's3']);
    expect([view.reviewed, view.fallback]).toEqual([false, false]);

    const first = await mock.reviewStep(SESSION, 's1');
    expect(first.prev).toBeUndefined();
    const last = await mock.reviewStep(SESSION, 's8');
    expect([last.number, last.next]).toEqual([8, undefined]);
  });

  it('F-07.2 the number follows the reader’s order', async () => {
    const mock = await planned();
    await mock.reviewSetStrategy(SESSION, 'testsFirst');
    const view = await mock.reviewStep(SESSION, 's8');
    expect([view.number, view.prev, view.next]).toEqual([1, undefined, 's1']);
  });

  it('F-07.2 refused before the plan and for a step not in it', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await expect(mock.reviewStep(SESSION, 's1')).rejects.toThrow("The plan isn't ready yet.");
    await mock.reviewPlan(SESSION, () => undefined);
    await expect(mock.reviewStep(SESSION, 's9')).rejects.toThrow('The step is not in the plan.');
  });

  it('F-07.2 a fallback plan’s steps open too', async () => {
    const mock = await planned({ planFails: true });
    const view = await mock.reviewStep(SESSION, 'f1');
    expect([view.number, view.fallback]).toEqual([1, true]);
    expect(view.files.length).toBeGreaterThan(0);
  });

  it('F-07.3 the step’s files in GitLab file order with +add −del', async () => {
    const mock = await planned();
    const s1 = await mock.reviewStep(SESSION, 's1');
    expect(s1.files.map((f) => [f.newPath, f.additions, f.deletions])).toEqual([
      ['src/Mobile.Core/Uploads/IUploadQueue.cs', 22, 0],
      ['src/Mobile.Core/Uploads/QueuedPhoto.cs', 38, 0],
    ]);
    expect(s1.files.flatMap((f) => f.hunks.map((h) => h.id))).toEqual(
      expect.arrayContaining(s1.step.hunkIds),
    );
  });

  it('F-06.9 the two open threads are context in step 2 only', async () => {
    const mock = await planned();
    const s2 = await mock.reviewStep(SESSION, 's2');
    expect(s2.threads.map((t) => t.position?.newPath)).toEqual([QUEUE, QUEUE]);
    expect(s2.threads[0]?.notes[0]?.author.name).toBe('Paweł S.');
    expect((await mock.reviewStep(SESSION, 's1')).threads).toEqual([]);
  });
});
