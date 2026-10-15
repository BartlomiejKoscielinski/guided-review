import { describe, expect, it } from 'vitest';
import { createMockClient, type MockOptions } from '.';
import type { IpcClient } from '../client';
import { NOTES_STEP } from './fixtures/review';

// F-08.3: the S-04 rail's data in the mock backend, kept like the core keeps it in SQLite. "Change
// overview" is done once S-02 marked the plan opened (`sessionMarkPlanOpened`, read back as
// `SessionState.planOpened`); each draft carries its step (`Draft.stepId`): the note's step, or
// the step holding the hunk of its line.

const SESSION = 'mock-mr-session-1';
const OTHER_SESSION = 'mock-mr-session-2';
const QUEUE = 'src/Mobile.Core/Uploads/IUploadQueue.cs';
const SQLITE_QUEUE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const SKIMMED = 'src/Mobile.Core/Uploads/RetryPolicy.cs';

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

const onLine = (client: IpcClient, file: string, line: number) =>
  client.draftsCreate({
    sessionId: SESSION,
    findingId: null,
    body: `A comment on line ${String(line)}.`,
    position: { file, side: 'new', line },
    severity: null,
  });

describe('S-04 rail data in the mock backend (F-08.3)', () => {
  it('F-08.3 the plan counts as opened once S-02 marked it, per session, across a restart', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    expect((await before.sessionState(SESSION)).planOpened).toBe(false);
    await before.sessionMarkPlanOpened(SESSION);
    expect((await before.sessionState(SESSION)).planOpened).toBe(true);
    expect((await before.sessionState(OTHER_SESSION)).planOpened).toBe(false);

    const after = start(storage);
    expect((await after.sessionState(SESSION)).planOpened).toBe(true);
    expect((await after.sessionState(OTHER_SESSION)).planOpened).toBe(false);
  });

  it('F-08.3 a draft from a note carries the note’s step', async () => {
    const client = start(memoryStorage());
    await client.reviewFindings(SESSION, NOTES_STEP, ignore);
    const added = (await client.reviewDecide(SESSION, 'f2', { kind: 'addToDrafts' })).draft;
    expect(added?.stepId).toBe(NOTES_STEP);
    const edited = await client.draftsCreate({
      sessionId: SESSION,
      findingId: 'f1',
      body: 'Edited note.',
      position: null,
      severity: 'q',
    });
    expect(edited.stepId).toBe(NOTES_STEP);
    expect((await client.draftsList(SESSION)).map((d) => d.stepId)).toEqual([
      NOTES_STEP,
      NOTES_STEP,
    ]);
  });

  it('F-08.3 a draft on a line carries the step holding that line’s hunk', async () => {
    const client = start(memoryStorage());
    expect((await onLine(client, QUEUE, 2)).stepId).toBe('s1');
    expect((await onLine(client, SQLITE_QUEUE, 3)).stepId).toBe('s2');
    expect((await onLine(client, VM, 50)).stepId).toBe('s4');
  });

  it('F-08.3 a comment on the merge request or on a skimmed line belongs to no step', async () => {
    const client = start(memoryStorage());
    const general = await client.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: 'Looks good overall.',
      position: null,
      severity: null,
    });
    expect(general.stepId).toBeNull();
    expect((await onLine(client, SKIMMED, 2)).stepId).toBeNull();
  });
});
