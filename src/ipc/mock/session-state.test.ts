import { describe, expect, it } from 'vitest';
import { createMockClient, type MockOptions } from '.';
import type { IpcClient } from '../client';
import { NOTES_STEP } from './fixtures/review';

// F-04.3: session state survives app restarts. The mock backend keeps it where it keeps its
// settings - the storage that outlives a page load - like the core keeps it in SQLite, so a new
// client on the same storage is the app started again.

const SESSION = 'mock-mr-session-1';
const OTHER_SESSION = 'mock-mr-session-2';

type MockStorage = NonNullable<MockOptions['storage']>;

function memoryStorage(): MockStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

const start = (storage: MockStorage): IpcClient => createMockClient({ latencyMs: 0, storage });
const ignore = () => undefined;

describe('mock session state across a restart', () => {
  it('F-04.3 reviewed steps are still marked after a restart, per session', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    await before.reviewPlan(SESSION, ignore);
    await before.reviewMarkStep(SESSION, 's3', true);
    await before.reviewMarkStep(SESSION, 's1', true);
    await before.reviewMarkStep(SESSION, 's2', true);
    await before.reviewMarkStep(SESSION, 's2', false);
    await before.reviewPlan(OTHER_SESSION, ignore);
    await before.reviewMarkStep(OTHER_SESSION, 's5', true);

    const after = start(storage);
    const plan = await after.reviewPlan(SESSION, ignore);
    expect(plan.reviewed).toEqual(['s1', 's3']);
    expect((await after.reviewStep(SESSION, 's1')).reviewed).toBe(true);
    expect((await after.reviewStep(SESSION, 's2')).reviewed).toBe(false);
    expect((await after.reviewPlan(OTHER_SESSION, ignore)).reviewed).toEqual(['s5']);
    // Marks made after the restart are kept too.
    expect(await after.reviewMarkStep(SESSION, 's4', true)).toEqual(['s1', 's3', 's4']);
  });

  it('F-04.3 note decisions are still there after a restart and can be undone', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    await before.reviewFindings(SESSION, NOTES_STEP, ignore);
    await before.reviewDecide(SESSION, 'f2', { kind: 'addToDrafts' });
    await before.reviewDecide(SESSION, 'f3', { kind: 'dismiss' });
    await before.reviewDecide(SESSION, 'f4', { kind: 'editAndAdd', body: 'Catch it apart?' });

    const after = start(storage);
    const notes = await after.reviewFindings(SESSION, NOTES_STEP, ignore);
    expect(notes.findings.map((f) => [f.id, f.decision])).toEqual([
      ['f1', 'open'],
      ['f2', 'draft'],
      ['f3', 'dismissed'],
      ['f4', 'draft'],
    ]);
    // A decided note takes no second decision until it is undone, as before the restart.
    await expect(after.reviewDecide(SESSION, 'f2', { kind: 'dismiss' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await after.reviewDecide(SESSION, 'f2', { kind: 'undo' });
    await after.reviewDecide(SESSION, 'f3', { kind: 'undo' });
    expect((await after.draftsList(SESSION)).map((d) => d.findingId)).toEqual(['f4']);
  });

  it('F-04.3 drafts are still on the list after a restart, edits included', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    await before.reviewFindings(SESSION, NOTES_STEP, ignore);
    const fromNote = (await before.reviewDecide(SESSION, 'f2', { kind: 'addToDrafts' })).draft;
    const general = await before.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: 'Why a queue here?',
      position: null,
      severity: null,
    });
    await before.draftsUpdate(general.id, { body: 'Why a queue at all?', include: false });
    await before.draftsCreate({
      sessionId: OTHER_SESSION,
      findingId: null,
      body: 'Another review.',
      position: null,
      severity: null,
    });

    const after = start(storage);
    const drafts = await after.draftsList(SESSION);
    expect(drafts.map((d) => d.body)).toEqual([fromNote?.body, 'Why a queue at all?']);
    expect(drafts.map((d) => d.include)).toEqual([true, false]);
    expect(drafts.every((d) => d.publishedNoteId === null)).toBe(true);
    expect((await after.draftsList(OTHER_SESSION)).map((d) => d.body)).toEqual(['Another review.']);

    // A draft made after the restart gets an ID of its own.
    const later = await after.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: 'One more.',
      position: null,
      severity: null,
    });
    const ids = [
      ...(await after.draftsList(SESSION)),
      ...(await after.draftsList(OTHER_SESSION)),
    ].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(later.id);
  });

  it('F-04.3 a dragged step order is still the session’s order after a restart', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    await before.reviewPlan(SESSION, ignore);
    const dragged = ['s2', 's1', 's3', 's4', 's5', 's6', 's7', 's8'];
    await before.reviewReorderSteps(SESSION, dragged);

    const after = start(storage);
    const plan = await after.reviewPlan(SESSION, ignore);
    expect(plan.order).toEqual({ strategy: 'contractToUi', custom: true, order: dragged });
    expect((await after.reviewStep(SESSION, 's2')).number).toBe(1);
    // Picking a strategy clears it, also after a restart.
    const picked = await after.reviewSetStrategy(SESSION, 'testsFirst');
    expect(picked.custom).toBe(false);
  });

  it('F-04.3 a client on a fresh storage starts with nothing reviewed, decided or drafted', async () => {
    const used = memoryStorage();
    const before = start(used);
    await before.reviewPlan(SESSION, ignore);
    await before.reviewMarkStep(SESSION, 's1', true);
    await before.reviewFindings(SESSION, NOTES_STEP, ignore);
    await before.reviewDecide(SESSION, 'f1', { kind: 'dismiss' });

    const fresh = start(memoryStorage());
    expect((await fresh.reviewPlan(SESSION, ignore)).reviewed).toEqual([]);
    const notes = await fresh.reviewFindings(SESSION, NOTES_STEP, ignore);
    expect(notes.findings.every((f) => f.decision === 'open')).toBe(true);
    expect(await fresh.draftsList(SESSION)).toEqual([]);
  });
});
