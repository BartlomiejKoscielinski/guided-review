import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-26.6: the mock's `authorPushPipeline` and the thread state after a push stand in for the core's
// (docs/plans/M7.md F-26.6, decision 13) on !480 of mobile/mobile-app:
//  - authorPushPipeline(project, iid, sha) answers the MR's pipeline for exactly that sha as a
//    PipelineTab, or null while GitLab has not started one. The first lookup of a sha is null
//    ("Pipeline starting…"), a later one finds #18360 running (Author.dc.html: "Pipeline #18360
//    running"): { number: 18360, id: 18360, sha, status: 'running', latest: true }.
//  - after a push whose reply was sent: a resolved thread is no longer open (authorMr lists only
//    the other thread, toAnswer 1, resolved.count 2); a thread left open is 'replied' (toAnswer 1).

const PROJECT = 'mobile/mobile-app';
const IID = 480;
const THREAD = 'author-t1';
const SHA = '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40';
const BODY = 'Fixed in 9e1d4b7. Backoff now doubles and stops at 60 s.';

const client = () => createMockClient({ latencyMs: 0 });

async function pushed(resolve: boolean) {
  const ipc = client();
  const queued = await ipc.authorQueueReply(PROJECT, IID, THREAD, BODY, resolve, SHA);
  await ipc.authorPushAndReply(PROJECT, IID, queued.id);
  return ipc;
}

describe('mock authorPushPipeline (F-26.6)', () => {
  it('F-26.6 the first lookup of a sha finds no pipeline yet, a later one finds #18360 running', async () => {
    const ipc = client();

    const first = await ipc.authorPushPipeline(PROJECT, IID, SHA);
    const later = await ipc.authorPushPipeline(PROJECT, IID, SHA);

    expect(first).toBeNull();
    expect(later).toMatchObject({
      id: 18360,
      number: 18360,
      sha: SHA,
      status: 'running',
      latest: true,
    });
  });

  it('F-26.6 it needs a signed-in GitLab account like the other author commands', async () => {
    const ipc = createMockClient({ latencyMs: 0, gitlab: { state: 'noToken' } });

    await expect(ipc.authorPushPipeline(PROJECT, IID, SHA)).rejects.toMatchObject({
      code: 'GITLAB_UNAUTHORIZED',
    });
  });
});

describe('mock authorMr after Push and reply (F-26.6)', () => {
  it('F-26.6 a resolved thread leaves the open list and counts as resolved', async () => {
    const ipc = await pushed(true);

    const mr = await ipc.authorMr(PROJECT, IID);

    expect(mr.threads.map((t) => t.id)).toEqual(['author-t2']);
    expect(mr.toAnswer).toBe(1);
    expect(mr.resolved.count).toBe(2);
  });

  it('F-26.6 a thread replied to without Resolve stays listed as replied and no longer waits for an answer', async () => {
    const ipc = await pushed(false);

    const mr = await ipc.authorMr(PROJECT, IID);

    expect(mr.threads.find((t) => t.id === THREAD)?.status).toBe('replied');
    expect(mr.threads.find((t) => t.id === 'author-t2')?.status).toBe('question');
    expect(mr.toAnswer).toBe(1);
    expect(mr.resolved.count).toBe(1);
  });
});
