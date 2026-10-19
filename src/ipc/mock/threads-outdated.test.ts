import { describe, expect, it } from 'vitest';
import { createMockClient, MOCK_SESSION_DATA_KEY } from '.';
import type { Thread } from '../types/Thread';
import { MOCK_ORDERS, mockPlan } from './fixtures/plan';
import { MOCK_THREADS, mockStepView } from './fixtures/step';

// F-11.3 in the mock backend, as `review/step_view.rs` and `review/thread_place.rs` answer: an
// outdated thread (written on an older version) sits on its placed line when the step's hunks
// hold it, else on the file header of the first step in the reader's order that shows the file;
// a current thread on a line outside the hunks is on the file header too; a file that isn't in
// the MR keeps the thread out of every step (S-05 only). M5 decision 4.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const QUEUE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
const ANNA = { username: 'anna.k', name: 'Anna K.' };
const STEPS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

/** A thread written on version 3b8d1f0; `placedLine` is where the core found its line now. */
function outdated(id: string, path: string, newLine: number, placedLine?: number): Thread {
  return {
    id,
    resolvable: true,
    resolved: false,
    outdated: true,
    ...(placedLine === undefined ? {} : { placedLine }),
    position: { oldPath: path, newPath: path, newLine, headSha: '3b8d1f0', baseSha: '5e2a9c4' },
    notes: [
      { id: 9001, author: ANNA, body: `Note of ${id}`, createdAt: '2026-10-12T08:00:00.000Z' },
    ],
  };
}

/** A thread on the current version (the mock's head is 9c41e07). */
function current(id: string, path: string, newLine: number): Thread {
  return {
    id,
    resolvable: true,
    resolved: false,
    outdated: false,
    position: { oldPath: path, newPath: path, newLine, headSha: '9c41e07', baseSha: '5e2a9c4' },
    notes: [
      { id: 9002, author: ANNA, body: `Note of ${id}`, createdAt: '2026-10-12T08:00:00.000Z' },
    ],
  };
}

const ids = (threads: readonly Thread[] | undefined) => (threads ?? []).map((t) => t.id);

/** For each step that shows `id`: [step, 'line' | 'header']. */
function whereIs(threads: readonly Thread[], id: string, order = MOCK_ORDERS.contractToUi) {
  const plan = mockPlan();
  return STEPS.flatMap((step) => {
    const view = mockStepView(plan, order, step, false, false, threads);
    return [
      ...(ids(view?.threads).includes(id) ? [[step, 'line']] : []),
      ...(ids(view?.fileThreads).includes(id) ? [[step, 'header']] : []),
    ];
  });
}

describe('mock backend: threads on outdated lines (F-11.3)', () => {
  it('F-11.3 an outdated thread shows on its placed line of the step whose hunk holds it, not on the line it was written on', () => {
    // Written on line 120 (no such line now); the core placed it on line 14, in step 4's hunk.
    const placed = outdated('o1', VM, 120, 14);
    expect(whereIs([placed], 'o1')).toEqual([['s4', 'line']]);
    const view = mockStepView(mockPlan(), MOCK_ORDERS.contractToUi, 's4', false, false, [placed]);
    expect(view?.threads[0]?.placedLine).toBe(14);
    expect(view?.threads[0]?.outdated).toBe(true);
  });

  it('F-11.3 an outdated thread without a match is on the file header of the step that shows the file, even when its old line is inside a hunk', () => {
    // Line 24 of the queue is inside step 2's hunk, but the thread found no match.
    const noMatch = outdated('o2', QUEUE, 24);
    expect(whereIs([noMatch], 'o2')).toEqual([['s2', 'header']]);
    const view = mockStepView(mockPlan(), MOCK_ORDERS.contractToUi, 's2', false, false, [noMatch]);
    expect(ids(view?.threads)).toEqual([]);
    expect(view?.fileThreads[0]?.outdated).toBe(true);
  });

  it('F-11.3 a current thread on a line outside the hunks is on the file header, the others stay on their lines', () => {
    // VM line 5 is before step 4's first hunk (an expanded-context comment in GitLab).
    const context = current('c1', VM, 5);
    const threads = [...MOCK_THREADS, context];
    expect(whereIs(threads, 'c1')).toEqual([['s4', 'header']]);
    expect(whereIs(threads, 'd-482-3')).toEqual([['s4', 'line']]);
    expect(whereIs(threads, 'd-482-1')).toEqual([['s2', 'line']]);
  });

  it('F-11.3 a thread on a file that is not in the MR any more is in no step', () => {
    const gone = outdated('o3', 'src/Mobile.App/Removed.cs', 12);
    expect(whereIs([gone], 'o3')).toEqual([]);
  });

  it('F-11.3 the header card is in the first step of the reader’s order that shows the file', () => {
    // Step 4's last hunk moves to step 7, so two steps show the ViewModel.
    const plan = structuredClone(mockPlan());
    const s4 = plan.steps.find((s) => s.id === 's4');
    const s7 = plan.steps.find((s) => s.id === 's7');
    const last = s4?.hunkIds.filter((id) => id.startsWith(VM)).at(-1);
    if (!s4 || !s7 || last === undefined) throw new Error('the mock plan changed');
    s4.hunkIds = s4.hunkIds.filter((id) => id !== last);
    s7.hunkIds = [...s7.hunkIds, last];
    const noMatch = outdated('o4', VM, 60);
    const show = (order: string[]) =>
      STEPS.flatMap((step) => {
        const view = mockStepView(plan, order, step, false, false, [noMatch]);
        return ids(view?.fileThreads).includes('o4') ? [step] : [];
      });
    const rest = STEPS.filter((s) => s !== 's4' && s !== 's7');
    expect(show(['s4', 's7', ...rest])).toEqual(['s4']);
    expect(show(['s7', 's4', ...rest])).toEqual(['s7']);
  });

  it('F-11.3 a step without header threads has an empty list, not a missing one', () => {
    for (const step of STEPS) {
      const view = mockStepView(mockPlan(), MOCK_ORDERS.contractToUi, step, false, false);
      expect(view?.fileThreads, step).toEqual([]);
    }
  });

  it('F-11.3 the mock reads outdated threads from its stored session data, as the e2e seeds them', async () => {
    const saved = JSON.stringify({
      threads: [outdated('o5', VM, 120, 14), outdated('o6', VM, 60), current('c2', VM, 5)],
    });
    const mock = createMockClient({
      latencyMs: 0,
      review: { planCached: true },
      storage: {
        getItem: (key: string) => (key === MOCK_SESSION_DATA_KEY ? saved : null),
        setItem: () => undefined,
      },
    });
    await mock.reviewPlan(SESSION, () => undefined);
    const view = await mock.reviewStep(SESSION, 's4');
    expect(ids(view.threads)).toEqual(['o5']);
    expect(ids(view.fileThreads)).toEqual(['o6', 'c2']);
    // Another step shows none of them.
    const other = await mock.reviewStep(SESSION, 's3');
    expect(ids(other.threads)).toEqual([]);
    expect(ids(other.fileThreads)).toEqual([]);
  });
});
