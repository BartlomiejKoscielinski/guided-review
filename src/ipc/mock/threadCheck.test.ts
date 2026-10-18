import { describe, expect, it } from 'vitest';
import { createMockClient, MOCK_SESSION_DATA_KEY, type MockOptions } from '.';
import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';
import type { Thread } from '../types/Thread';

// F-13.3 in the mock backend, as `claude_thread_check` answers (plan M5, decision 12): the core
// judges the MR's open threads written on an older version against the commits since, and returns
// the ones a later commit addresses as { discussionId, commit (full id), hint }. Nothing is
// resolved, and no candidate means no Claude run. The mock stands in for Claude with a rule the
// e2e can seed: an open, resolvable thread written on version 3b8d1f0 (the version the mock's
// outdated threads are written on) is addressed by commit a91f2c0, hint "index added", the
// SummaryDesk.dc.html example; threads written on any other version are candidates Claude does
// not find addressed. Failures follow the other Claude tasks (F-18.7).

const SESSION = 'mock-mr-session-1';
/** Where the mock's outdated threads were written, and the commit that follows it. */
const WRITTEN_ON = '3b8d1f0';
const COMMIT = 'a91f2c0d4e8b5f36c17a09b2d3e4f5a6b7c8d9e0';
const ANNA = { username: 'anna.k', name: 'Anna K.' };

interface Seed {
  id: string;
  head?: string;
  resolved?: boolean;
  resolvable?: boolean;
}

function thread({ id, head = WRITTEN_ON, resolved = false, resolvable = true }: Seed): Thread {
  return {
    id,
    resolvable,
    resolved,
    outdated: true,
    position: {
      oldPath: 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs',
      newPath: 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs',
      newLine: 34,
      headSha: head,
      baseSha: '5e2a9c4',
    },
    notes: [
      { id: 9100, author: ANNA, body: `Note of ${id}`, createdAt: '2026-10-12T08:00:00.000Z' },
    ],
  };
}

function backend(threads: Thread[], options: MockOptions = {}): IpcClient {
  const saved = JSON.stringify({ threads });
  return createMockClient({
    latencyMs: 0,
    ...options,
    storage: {
      getItem: (key: string) => (key === MOCK_SESSION_DATA_KEY ? saved : null),
      setItem: () => undefined,
    },
  });
}

const check = (ipc: IpcClient, events: ClaudeTaskEvent<unknown>[] = []) =>
  ipc.claudeThreadCheck(SESSION, (event) => events.push(event));

async function rejection(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IpcError) return error;
    throw error;
  }
  throw new Error('expected the call to reject');
}

describe('mock thread check (F-13.3)', () => {
  it('F-13.3 an open thread written on 3b8d1f0 is addressed by commit a91f2c0 with the hint "index added"', async () => {
    const ipc = backend([thread({ id: 'o-index' })]);
    const events: ClaudeTaskEvent<unknown>[] = [];
    const result = await check(ipc, events);
    expect(result).toEqual({
      hints: [{ discussionId: 'o-index', commit: COMMIT, hint: 'index added' }],
    });
    expect(events.map((e) => e.kind)).toEqual(['queued', 'started', 'done']);
    expect(events.at(-1)).toEqual({ kind: 'done', result });
  });

  it('F-13.3 only the candidates written on that version are addressed: other versions, resolved threads and comments that cannot be resolved are not', async () => {
    const ipc = backend([
      thread({ id: 'o-index' }),
      thread({ id: 'o-other', head: '2c7a4be' }),
      thread({ id: 'o-resolved', resolved: true }),
      thread({ id: 'o-comment', resolvable: false }),
    ]);
    expect(await check(ipc)).toEqual({
      hints: [{ discussionId: 'o-index', commit: COMMIT, hint: 'index added' }],
    });
  });

  it('F-13.3 a candidate Claude does not find addressed gives no hint', async () => {
    const ipc = backend([thread({ id: 'o-other', head: '2c7a4be' })]);
    expect(await check(ipc)).toEqual({ hints: [] });
  });

  it('F-13.3 the threads of !482 as the mock has them are all written on the reviewed version: no candidate, no hint, no failure', async () => {
    // A Claude at its usage limit still answers: with no candidate the core starts no run.
    const ipc = createMockClient({ latencyMs: 0, claude: { suggestFails: 'limited' } });
    expect(await check(ipc)).toEqual({ hints: [] });
  });

  it('F-13.3 nothing is resolved by the check', async () => {
    const ipc = backend([thread({ id: 'o-index' })]);
    await check(ipc);
    const threads = await ipc.gitlabDiscussions(SESSION);
    expect(threads.map((t) => [t.id, t.resolved])).toEqual([['o-index', false]]);
  });

  it('F-13.3 a Claude that is not signed in or at its usage limit fails the check with the core codes and a failed event', async () => {
    for (const [suggestFails, code] of [
      ['notSignedIn', 'CLAUDE_NOT_SIGNED_IN'],
      ['limited', 'CLAUDE_LIMITED'],
    ] as const) {
      const ipc = backend([thread({ id: 'o-index' })], { claude: { suggestFails } });
      const events: ClaudeTaskEvent<unknown>[] = [];
      const error = await rejection(check(ipc, events));
      expect(error.code).toBe(code);
      const failed = events.at(-1);
      expect(failed?.kind).toBe('failed');
    }
  });
});
