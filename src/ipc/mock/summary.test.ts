import { describe, expect, it } from 'vitest';
import { createMockClient, type MockOptions } from '.';
import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';

// F-12.4: the summary comment of the mock backend (SummaryDesk.dc.html: the text the area is
// prefilled with) and what S-05 keeps of it per session. A new client on the same storage is the
// app started again.

const SESSION = 'mock-mr-session-1';
const OTHER = 'mock-mr-session-2';
/** `summary` of SummaryDesk.dc.html. */
const MOCK_SUMMARY =
  'Thanks, the offline queue approach looks good. Before merging: handle camera cancellation, refresh the counter after uploads, and cap retries in UploadWorker.';

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

const start = (storage: MockStorage, options: MockOptions = {}): IpcClient =>
  createMockClient({ latencyMs: 0, storage, ...options });

async function planned(ipc: IpcClient) {
  await ipc.repoPick();
  await ipc.reviewPlan(SESSION, () => undefined);
}

describe('mock summary comment (F-12.4)', () => {
  it('F-12.4 the task answers like the core: queued, started, then done with the mock summary', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    await planned(ipc);
    const events: ClaudeTaskEvent<unknown>[] = [];
    const result = await ipc.claudeSummaryComment(SESSION, (event) => events.push(event));
    expect(result).toEqual({ summary: MOCK_SUMMARY });
    expect(events.map((e) => e.kind)).toEqual(['queued', 'started', 'done']);
    expect(events.at(-1)).toEqual({ kind: 'done', result: { summary: MOCK_SUMMARY } });
  });

  it('F-12.4 a Claude that is not signed in or at its usage limit fails the task with the core codes', async () => {
    for (const [suggestFails, code] of [
      ['notSignedIn', 'CLAUDE_NOT_SIGNED_IN'],
      ['limited', 'CLAUDE_LIMITED'],
    ] as const) {
      const ipc = createMockClient({ latencyMs: 0, claude: { suggestFails } });
      await planned(ipc);
      const error: unknown = await ipc
        .claudeSummaryComment(SESSION, () => undefined)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(IpcError);
      expect((error as IpcError).code).toBe(code);
    }
  });

  it('F-12.4 a session starts with the box unticked, no text and no suggestion', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    await planned(ipc);
    expect(await ipc.sessionSummary(SESSION)).toEqual({
      enabled: false,
      text: '',
      suggested: false,
    });
  });

  it('F-12.4 the tick, the text and the suggested flag are kept per session and survive a restart', async () => {
    const storage = memoryStorage();
    const before = start(storage);
    await planned(before);
    const written = { enabled: true, text: 'Zażółć gęślą jaźń.\nSecond line.', suggested: true };
    await before.sessionSetSummary(SESSION, written);
    expect(await before.sessionSummary(SESSION)).toEqual(written);
    // Another session of the app keeps its own.
    expect(await before.sessionSummary(OTHER)).toEqual({
      enabled: false,
      text: '',
      suggested: false,
    });

    const after = start(storage);
    expect(await after.sessionSummary(SESSION)).toEqual(written);

    const own = { enabled: false, text: 'My own words.', suggested: false };
    await after.sessionSetSummary(SESSION, own);
    expect(await start(storage).sessionSummary(SESSION)).toEqual(own);
  });
});
