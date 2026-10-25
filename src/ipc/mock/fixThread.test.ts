import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { IpcError } from '../errors';

// F-25.1 on S-10: the mock's `fixProposeThread` answers like the core's `fix_propose_thread`
// (commands/fix_thread.rs): only a change thread on a file of my MR, with the checkout on its
// source branch, is fixed; a teammate's MR and a checkout off the source branch are
// FIX_NOT_ALLOWED before any event, a question is INVALID_INPUT.

const PROJECT = 'mobile/mobile-app';
const MINE = 480;
const TEAMMATES = 482;

async function backend(options: Parameters<typeof createMockClient>[0] = {}) {
  const mock = createMockClient({ latencyMs: 0, ...options });
  await mock.repoPick();
  return mock;
}

async function rejection(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IpcError) return error;
    throw error;
  }
  throw new Error('expected the call to reject');
}

describe('mock fixProposeThread (F-25.1)', () => {
  it("F-25.1 a change thread of my MR on its source branch gives Author.dc.html's proposal", async () => {
    const mock = await backend();
    const events: string[] = [];
    const proposal = await mock.fixProposeThread(
      { task: 'fix-t1', project: PROJECT, iid: MINE, threadId: 'author-t1' },
      (e) => events.push(e.kind),
    );
    expect(events).toEqual(['started', 'done']);
    expect(proposal.file).toBe('src/App/Workers/UploadWorker.cs');
    expect(proposal.explanation).toBe(
      'Doubles the wait after each attempt (2, 4, 8 … s) and caps it at 60 s, as Marta asked.',
    );
    const lines = proposal.hunks.flatMap((h) => h.lines);
    expect(lines.find((l) => l.kind === 'del')?.text.trim()).toBe(
      'await Task.Delay(1000 * attempt, ct);',
    );
    await mock.fixDiscard(proposal.id);
  });

  it("F-25.1 never on a teammate's MR: FIX_NOT_ALLOWED before any event", async () => {
    const mock = await backend();
    const events: string[] = [];
    const error = await rejection(
      mock.fixProposeThread(
        { task: 'fix-x', project: PROJECT, iid: TEAMMATES, threadId: 'author-t1' },
        (e) => events.push(e.kind),
      ),
    );
    expect(error.code).toBe('FIX_NOT_ALLOWED');
    expect(events).toEqual([]);
  });

  it('F-25.1 a checkout off the source branch (F-26.8) is FIX_NOT_ALLOWED', async () => {
    const mock = await backend({ author: { onSourceBranch: false } });
    const error = await rejection(
      mock.fixProposeThread(
        { task: 'fix-y', project: PROJECT, iid: MINE, threadId: 'author-t1' },
        () => undefined,
      ),
    );
    expect(error.code).toBe('FIX_NOT_ALLOWED');
  });

  it('F-25.1 a question thread is answered, not fixed: INVALID_INPUT', async () => {
    const mock = await backend();
    const error = await rejection(
      mock.fixProposeThread(
        { task: 'fix-z', project: PROJECT, iid: MINE, threadId: 'author-t2' },
        () => undefined,
      ),
    );
    expect(error.code).toBe('INVALID_INPUT');
  });
});
