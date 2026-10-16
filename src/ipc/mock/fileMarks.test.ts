import { describe, expect, it } from 'vitest';
import { createMockClient, type MockOptions } from '.';
import type { IpcClient } from '../client';

// F-07.10: each file of a step can be marked reviewed on its own. The mock backend keeps the marks
// per session, step and file where it keeps the rest of the session (the storage that outlives a
// page load), as the core keeps them in SQLite: `reviewMarkFile` marks or unmarks one file and
// answers the plan's reviewed steps like `reviewMarkStep`; a step is reviewed when all its files
// are; Mark reviewed marks all its files and on a reviewed step unmarks them; a step marked
// reviewed before file marks existed counts as all files reviewed; `sessionState().reviewedFiles`
// lists, per step, the files marked on their own (what S-03 and S-04 draw their toggles from).

const SESSION = 'mock-mr-session-1';
const OTHER_SESSION = 'mock-mr-session-2';
const SESSION_DATA_KEY = 'guided-review.mock.sessionData';
// Step 5 holds two files (the diff's order: Converters before Views), step 4 holds one.
const CONVERTER = 'src/Mobile.App/Converters/PendingCountConverter.cs';
const BANNER = 'src/Mobile.App/Views/OfflineBanner.xaml';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';

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

/** A client whose session `SESSION` has its plan, as S-02 prepares it. */
async function planned(storage = memoryStorage()): Promise<IpcClient> {
  const mock = start(storage);
  await mock.reviewPlan(SESSION, ignore);
  return mock;
}

/** The files marked on their own in `step`, as S-03 and S-04 read them. */
async function marked(mock: IpcClient, step: string, session = SESSION): Promise<string[]> {
  const state = await mock.sessionState(session);
  return [...(state.reviewedFiles[step] ?? [])].sort();
}

describe('mock file marks (F-07.10)', () => {
  it('F-07.10 a session has no file marks until one is made; the plan must exist first', async () => {
    const mock = start(memoryStorage());
    await expect(mock.reviewMarkFile(SESSION, 's5', CONVERTER, true)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: "The plan isn't ready yet.",
    });
    await mock.reviewPlan(SESSION, ignore);
    expect((await mock.sessionState(SESSION)).reviewedFiles).toEqual({});
  });

  it('F-07.10 reviewMarkFile marks one file; the step is reviewed when all its files are', async () => {
    const mock = await planned();
    expect(await mock.reviewMarkFile(SESSION, 's5', CONVERTER, true)).toEqual([]);
    expect(await marked(mock, 's5')).toEqual([CONVERTER]);
    expect((await mock.reviewStep(SESSION, 's5')).reviewed).toBe(false);
    expect((await mock.reviewPlan(SESSION, ignore)).reviewed).toEqual([]);

    // The last file completes the step; the answer lists the reviewed steps in the plan's order.
    expect(await mock.reviewMarkFile(SESSION, 's5', BANNER, true)).toEqual(['s5']);
    expect((await mock.reviewStep(SESSION, 's5')).reviewed).toBe(true);
    expect((await mock.reviewPlan(SESSION, ignore)).reviewed).toEqual(['s5']);
    expect(await mock.reviewMarkFile(SESSION, 's4', VM, true)).toEqual(['s4', 's5']);

    // One file taken back and the step is not reviewed any more; the other file stays marked.
    expect(await mock.reviewMarkFile(SESSION, 's5', CONVERTER, false)).toEqual(['s4']);
    expect(await marked(mock, 's5')).toEqual([BANNER]);
    expect((await mock.reviewStep(SESSION, 's5')).reviewed).toBe(false);
    expect((await mock.reviewPlan(SESSION, ignore)).reviewed).toEqual(['s4']);
  });

  it('F-07.10 marking a file twice, or unmarking one that is not marked, changes nothing', async () => {
    const mock = await planned();
    await mock.reviewMarkFile(SESSION, 's5', BANNER, false);
    expect(await marked(mock, 's5')).toEqual([]);
    await mock.reviewMarkFile(SESSION, 's5', BANNER, true);
    await mock.reviewMarkFile(SESSION, 's5', BANNER, true);
    expect(await marked(mock, 's5')).toEqual([BANNER]);
    expect((await mock.reviewStep(SESSION, 's5')).reviewed).toBe(false);
  });

  it('F-07.10 reviewMarkStep marks all files of the step and on a reviewed step unmarks them', async () => {
    const mock = await planned();
    await mock.reviewMarkFile(SESSION, 's5', CONVERTER, true);
    expect(await mock.reviewMarkStep(SESSION, 's5', true)).toEqual(['s5']);
    expect((await mock.reviewStep(SESSION, 's5')).reviewed).toBe(true);

    // Taking one file back from a step marked as a whole keeps the other file marked.
    expect(await mock.reviewMarkFile(SESSION, 's5', CONVERTER, false)).toEqual([]);
    expect(await marked(mock, 's5')).toEqual([BANNER]);
    expect((await mock.reviewStep(SESSION, 's5')).reviewed).toBe(false);

    await mock.reviewMarkStep(SESSION, 's5', true);
    expect(await mock.reviewMarkStep(SESSION, 's5', false)).toEqual([]);
    expect(await marked(mock, 's5')).toEqual([]);
    expect((await mock.reviewStep(SESSION, 's5')).reviewed).toBe(false);
    // Marking one file after that starts from nothing marked.
    await mock.reviewMarkFile(SESSION, 's5', BANNER, true);
    expect(await marked(mock, 's5')).toEqual([BANNER]);
  });

  it('F-07.10 a step marked reviewed before file marks existed counts as all files reviewed', async () => {
    const storage = memoryStorage();
    await planned(storage);
    // What the app stored before: the step in the session's reviewed steps, no file marks.
    const data = JSON.parse(storage.getItem(SESSION_DATA_KEY) ?? '{}') as {
      marks?: Record<string, string[]>;
    };
    storage.setItem(
      SESSION_DATA_KEY,
      JSON.stringify({ ...data, marks: { ...data.marks, [SESSION]: ['s5'] } }),
    );

    const mock = start(storage);
    expect((await mock.reviewStep(SESSION, 's5')).reviewed).toBe(true);
    expect(await mock.reviewMarkFile(SESSION, 's5', BANNER, false)).toEqual([]);
    expect(await marked(mock, 's5')).toEqual([CONVERTER]);
    expect((await mock.reviewStep(SESSION, 's5')).reviewed).toBe(false);
  });

  it('F-07.10 file marks survive a restart, per session and step', async () => {
    const storage = memoryStorage();
    const before = await planned(storage);
    await before.reviewPlan(OTHER_SESSION, ignore);
    await before.reviewMarkFile(SESSION, 's5', CONVERTER, true);
    await before.reviewMarkFile(SESSION, 's4', VM, true);
    await before.reviewMarkFile(OTHER_SESSION, 's5', BANNER, true);

    const after = start(storage);
    expect(await marked(after, 's5')).toEqual([CONVERTER]);
    expect(await marked(after, 's4')).toEqual([VM]);
    expect(await marked(after, 's5', OTHER_SESSION)).toEqual([BANNER]);
    expect((await after.reviewPlan(SESSION, ignore)).reviewed).toEqual(['s4']);
    expect((await after.reviewStep(SESSION, 's4')).reviewed).toBe(true);
    // Marks made after the restart are kept on top.
    expect(await after.reviewMarkFile(SESSION, 's5', BANNER, true)).toEqual(['s4', 's5']);
  });

  it('F-07.10 a step outside the plan or a file outside the step is refused and marks nothing', async () => {
    const mock = await planned();
    await expect(mock.reviewMarkFile(SESSION, 'nope', CONVERTER, true)).rejects.toMatchObject({
      message: 'The step is not in the plan.',
    });
    // The view model belongs to step 4; an unknown path is in no step.
    for (const file of [VM, 'src/Mobile.App/Nowhere.cs']) {
      await expect(mock.reviewMarkFile(SESSION, 's5', file, true)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    }
    expect(await marked(mock, 's5')).toEqual([]);
    expect(await marked(mock, 's4')).toEqual([]);
    expect((await mock.sessionState(SESSION)).reviewedFiles).toEqual({});
  });
});
