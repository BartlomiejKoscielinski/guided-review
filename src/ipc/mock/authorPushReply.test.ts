import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-26.5: the mock's `authorQueueReply` and `authorPushAndReply` stand in for the core's
// (docs/plans/M7.md F-26.5, decisions 11 and 12) on !480 of mobile/mobile-app:
//  - authorQueueReply(project, iid, discussion, body, resolve, afterSha) answers
//    { id, discussion, body, resolve, afterSha, state: 'queued', error: null }; queueing the same
//    thread again replaces body and resolve and keeps the id.
//  - a queued reply makes `authorMr`'s thread read status 'fixedLocally' (S-10's tag).
//  - authorPushAndReply(project, iid, id) answers { kind: 'done', remoteBranch:
//    'origin/<source branch>', resolved } (resolved = the queued switch); with the scenario
//    `changes: { pushFails: 'rejected' }` (the same remote-has-commits condition as `gitPush`) it
//    answers { kind: 'pullFirst' } and the reply stays queued. An unknown id is INVALID_INPUT, like
//    the core's.

const PROJECT = 'mobile/mobile-app';
const IID = 480;
const THREAD = 'author-t1';
const SHA = '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40';
const BODY = 'Fixed in 9e1d4b7. Backoff now doubles and stops at 60 s.';

const client = (changes = {}) => createMockClient({ latencyMs: 0, changes });

describe('mock authorQueueReply and authorPushAndReply (F-26.5)', () => {
  it('F-26.5 queueing answers the queued reply; queueing the thread again keeps its id and takes the new text', async () => {
    const ipc = client();

    const first = await ipc.authorQueueReply(PROJECT, IID, THREAD, BODY, true, SHA);
    const second = await ipc.authorQueueReply(
      PROJECT,
      IID,
      THREAD,
      'Fixed in 9e1d4b7. Final.',
      false,
      SHA,
    );

    expect(first).toEqual({
      id: expect.any(String) as string,
      discussion: THREAD,
      body: BODY,
      resolve: true,
      afterSha: SHA,
      state: 'queued',
      error: null,
    });
    expect(second.id).toBe(first.id);
    expect(second.body).toBe('Fixed in 9e1d4b7. Final.');
    expect(second.resolve).toBe(false);
  });

  it('F-26.5 a queued reply turns the thread’s status into fixedLocally, the other thread is untouched', async () => {
    const ipc = client();
    const before = await ipc.authorMr(PROJECT, IID);

    await ipc.authorQueueReply(PROJECT, IID, THREAD, BODY, true, SHA);

    const after = await ipc.authorMr(PROJECT, IID);
    const status = (mr: typeof after, id: string) => mr.threads.find((t) => t.id === id)?.status;
    expect(status(before, THREAD)).not.toBe('fixedLocally');
    expect(status(after, THREAD)).toBe('fixedLocally');
    expect(status(after, 'author-t2')).toBe(status(before, 'author-t2'));
  });

  it('F-26.5 pushing answers done on origin/<source branch> with the queued switch', async () => {
    const on = client();
    const queuedOn = await on.authorQueueReply(PROJECT, IID, THREAD, BODY, true, SHA);
    const off = client();
    const queuedOff = await off.authorQueueReply(PROJECT, IID, THREAD, BODY, false, SHA);

    await expect(on.authorPushAndReply(PROJECT, IID, queuedOn.id)).resolves.toEqual({
      kind: 'done',
      remoteBranch: 'origin/feature/upload-retry',
      resolved: true,
    });
    await expect(off.authorPushAndReply(PROJECT, IID, queuedOff.id)).resolves.toEqual({
      kind: 'done',
      remoteBranch: 'origin/feature/upload-retry',
      resolved: false,
    });
  });

  it('F-26.5 a remote with commits you don’t have is pullFirst and the reply stays queued', async () => {
    const ipc = client({ pushFails: 'rejected' });
    const queued = await ipc.authorQueueReply(PROJECT, IID, THREAD, BODY, true, SHA);

    await expect(ipc.authorPushAndReply(PROJECT, IID, queued.id)).resolves.toEqual({
      kind: 'pullFirst',
    });

    const mr = await ipc.authorMr(PROJECT, IID);
    expect(mr.threads.find((t) => t.id === THREAD)?.status).toBe('fixedLocally');
  });

  it('F-26.5 pushing a reply that was never queued is INVALID_INPUT', async () => {
    await expect(client().authorPushAndReply(PROJECT, IID, 'nope')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});
