import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { IpcError } from '../errors';

// F-11.2 in the mock backend, as the core answers (plan: `gitlab_resolve(session, discussion,
// resolved)` and `gitlab_reply(session, discussion, body)`; the project and the MR come from the
// session): Resolve and Reopen change the thread in the step view, a reply is appended to it
// under the signed-in user, and a failed call changes nothing.

const SESSION = 'mock-mr-session-1';
// !482's threads (Review.dc.html): d-482-1 and d-482-2 in step 2, d-482-3 at _worker.Kick() in step 4.
const KICK = 'd-482-3';

async function backend(options: Parameters<typeof createMockClient>[0] = {}) {
  const mock = createMockClient({ latencyMs: 0, ...options });
  await mock.reviewPlan(SESSION, () => undefined);
  return mock;
}

const threadOf = async (mock: Awaited<ReturnType<typeof backend>>, step: string, id: string) => {
  const view = await mock.reviewStep(SESSION, step);
  return view.threads.find((t) => t.id === id);
};

async function rejection(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IpcError) return error;
    throw error;
  }
  throw new Error('expected the call to reject');
}

describe('mock thread actions (F-11.2)', () => {
  it('F-11.2 Resolve marks the thread resolved in the step view and Reopen makes it open again', async () => {
    const mock = await backend();
    expect((await threadOf(mock, 's4', KICK))?.resolved).toBe(false);

    await mock.gitlabResolve(SESSION, KICK, true);
    expect((await threadOf(mock, 's4', KICK))?.resolved).toBe(true);

    await mock.gitlabResolve(SESSION, KICK, false);
    expect((await threadOf(mock, 's4', KICK))?.resolved).toBe(false);
  });

  it('F-11.2 resolving one thread leaves the other threads open', async () => {
    const mock = await backend();
    await mock.gitlabResolve(SESSION, 'd-482-1', true);

    const step2 = await mock.reviewStep(SESSION, 's2');
    expect(step2.threads.map((t) => [t.id, t.resolved])).toEqual([
      ['d-482-1', true],
      ['d-482-2', false],
    ]);
    expect((await threadOf(mock, 's4', KICK))?.resolved).toBe(false);
  });

  it('F-11.2 a reply is appended to the thread as the signed-in user, now, after the notes already there', async () => {
    const mock = await backend();
    const before = (await threadOf(mock, 's4', KICK))?.notes ?? [];
    expect(before).toHaveLength(2);

    const sentAt = Date.now();
    await mock.gitlabReply(SESSION, KICK, 'Thanks, that answers it.');

    const after = (await threadOf(mock, 's4', KICK))?.notes ?? [];
    expect(after).toHaveLength(3);
    expect(after.slice(0, 2)).toEqual(before);
    const reply = after[2];
    expect(reply?.body).toBe('Thanks, that answers it.');
    // The signed-in user of the mock GitLab account (Settings.dc.html › GitLab).
    expect(reply?.author).toEqual({ username: 'bartek.k', name: 'Bartek K.' });
    const age = Math.abs(new Date(reply?.createdAt ?? '').getTime() - sentAt);
    expect(age).toBeLessThan(5000);
    expect(new Set(after.map((n) => n.id)).size).toBe(3);
  });

  it('F-11.2 a reply keeps its text exactly: Markdown, line breaks and Polish letters', async () => {
    const mock = await backend();
    const text = 'Zażółć gęślą jaźń:\n- `Kick()` zwalnia semafor\n- <b>nie</b> blokuje';
    await mock.gitlabReply(SESSION, KICK, text);
    const notes = (await threadOf(mock, 's4', KICK))?.notes ?? [];
    expect(notes.at(-1)?.body).toBe(text);
  });

  it('F-11.2 replying does not resolve the thread, resolving does not add a note', async () => {
    const mock = await backend();
    await mock.gitlabReply(SESSION, KICK, 'On it.');
    expect((await threadOf(mock, 's4', KICK))?.resolved).toBe(false);

    await mock.gitlabResolve(SESSION, KICK, true);
    expect((await threadOf(mock, 's4', KICK))?.notes).toHaveLength(3);
  });

  it('F-11.2 a reply is not a draft: the session has no draft after it', async () => {
    const mock = await backend();
    await mock.gitlabReply(SESSION, KICK, 'Sent, not saved for later.');
    await mock.gitlabResolve(SESSION, 'd-482-1', true);
    expect(await mock.draftsList(SESSION)).toEqual([]);
  });

  it('F-11.2 another mock backend starts with the threads as the design has them', async () => {
    const first = await backend();
    await first.gitlabResolve(SESSION, KICK, true);
    await first.gitlabReply(SESSION, KICK, 'Only in the first backend.');

    const second = await backend();
    const thread = await threadOf(second, 's4', KICK);
    expect(thread?.resolved).toBe(false);
    expect(thread?.notes).toHaveLength(2);
  });

  it('F-11.2 a discussion that is not in the merge request answers GITLAB_NOT_FOUND and changes nothing', async () => {
    const mock = await backend();
    const resolve = await rejection(mock.gitlabResolve(SESSION, 'd-missing', true));
    expect(resolve.code).toBe('GITLAB_NOT_FOUND');
    const reply = await rejection(mock.gitlabReply(SESSION, 'd-missing', 'Hello?'));
    expect(reply.code).toBe('GITLAB_NOT_FOUND');

    for (const [step, id] of [
      ['s2', 'd-482-1'],
      ['s2', 'd-482-2'],
      ['s4', KICK],
    ] as const) {
      const thread = await threadOf(mock, step, id);
      expect(thread?.resolved, id).toBe(false);
    }
    expect((await threadOf(mock, 's4', KICK))?.notes).toHaveLength(2);
  });

  it('F-11.2 a blank reply is refused with INVALID_INPUT and adds no note', async () => {
    const mock = await backend();
    const error = await rejection(mock.gitlabReply(SESSION, KICK, '  \n '));
    expect(error.code).toBe('INVALID_INPUT');
    expect((await threadOf(mock, 's4', KICK))?.notes).toHaveLength(2);
  });

  it('F-11.2 a session without a merge request has no thread to act on: INVALID_INPUT', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.repoPick();
    const { sessionId } = await mock.sessionOpenCommit({ to: 'a3f9c12' });
    await mock.reviewPlan(sessionId, () => undefined);

    const resolve = await rejection(mock.gitlabResolve(sessionId, KICK, true));
    expect(resolve.code).toBe('INVALID_INPUT');
    const reply = await rejection(mock.gitlabReply(sessionId, KICK, 'Hello?'));
    expect(reply.code).toBe('INVALID_INPUT');
  });

  it('F-11.2 without a GitLab token the actions answer GITLAB_UNAUTHORIZED, as the lists do', async () => {
    const mock = await backend({ gitlab: { state: 'noToken' } });
    const resolve = await rejection(mock.gitlabResolve(SESSION, KICK, true));
    expect(resolve.code).toBe('GITLAB_UNAUTHORIZED');
    const reply = await rejection(mock.gitlabReply(SESSION, KICK, 'Hello?'));
    expect(reply.code).toBe('GITLAB_UNAUTHORIZED');
    expect((await threadOf(mock, 's4', KICK))?.resolved).toBe(false);
  });
});

// F-12.2: `gitlab_discussions(session)`, the MR's threads for S-05's "Threads N open", read only.
describe('mock MR threads (F-12.2)', () => {
  it('F-12.2 gitlabDiscussions answers the three open threads of !482, oldest first', async () => {
    const mock = await backend();
    const threads = await mock.gitlabDiscussions(SESSION);
    expect(threads.map((t) => [t.id, t.resolvable, t.resolved])).toEqual([
      ['d-482-1', true, false],
      ['d-482-2', true, false],
      ['d-482-3', true, false],
    ]);
  });

  it('F-12.2 a resolved thread comes back resolved, a reopened one open again', async () => {
    const mock = await backend();
    await mock.gitlabResolve(SESSION, KICK, true);
    expect((await mock.gitlabDiscussions(SESSION)).find((t) => t.id === KICK)?.resolved).toBe(true);
    await mock.gitlabResolve(SESSION, KICK, false);
    expect((await mock.gitlabDiscussions(SESSION)).find((t) => t.id === KICK)?.resolved).toBe(
      false,
    );
  });

  it('F-12.2 a session without a merge request answers INVALID_INPUT, without a token GITLAB_UNAUTHORIZED', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.repoPick();
    const { sessionId } = await mock.sessionOpenCommit({ to: 'a3f9c12' });
    expect((await rejection(mock.gitlabDiscussions(sessionId))).code).toBe('INVALID_INPUT');

    const noToken = await backend({ gitlab: { state: 'noToken' } });
    expect((await rejection(noToken.gitlabDiscussions(SESSION))).code).toBe('GITLAB_UNAUTHORIZED');
  });
});
