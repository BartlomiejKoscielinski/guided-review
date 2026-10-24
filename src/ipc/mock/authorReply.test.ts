import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-26.7: the mock's `claudeReplyDraft` and `authorReply` stand in for the core's
// (docs/plans/M7.md F-26.7) on !480 of mobile/mobile-app:
//  - claudeReplyDraft(project, iid, discussion) answers { reply } with the text Author.dc.html's
//    "Draft with Claude" fills for Piotr S.'s question; sends nothing and changes no thread. A
//    discussion the MR doesn't have is GITLAB_NOT_FOUND ("GitLab didn't find it.").
//  - authorReply(project, iid, discussion, body) answers at once (undefined) and adds the reply as
//    the thread's last note, mine ("Bartek K." / BK); the question then reads 'answered' and one
//    thread less is to answer; nothing is queued. An empty or blank body is INVALID_INPUT ("Write
//    the reply to send."), an unknown discussion GITLAB_NOT_FOUND, as the core's.

const PROJECT = 'mobile/mobile-app';
const IID = 480;
const QUESTION = 'author-t2';
const CHANGE = 'author-t1';
const REPLY =
  'Nothing is lost: the photo stays in the SQLite queue until it’s sent. Only the attempt count is in memory, so after a restart the backoff starts again from 2 s. That felt acceptable, but I can persist it if you prefer.';

const client = () => createMockClient({ latencyMs: 0 });

describe('mock claudeReplyDraft (F-26.7)', () => {
  it('F-26.7 the draft is the mock’s text for the question and changes nothing', async () => {
    const ipc = client();
    const before = await ipc.authorMr(PROJECT, IID);

    const draft = await ipc.claudeReplyDraft(PROJECT, IID, QUESTION);

    expect(draft).toEqual({ reply: REPLY });
    expect(draft.reply.length).toBeLessThanOrEqual(800);
    expect(await ipc.authorMr(PROJECT, IID)).toEqual(before);
  });

  it('F-26.7 a discussion the MR does not have is GITLAB_NOT_FOUND', async () => {
    await expect(client().claudeReplyDraft(PROJECT, IID, 'no-such-thread')).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
      message: "GitLab didn't find it.",
    });
  });
});

describe('mock authorReply (F-26.7)', () => {
  it('F-26.7 the reply becomes my last note, the question reads answered and one thread less is to answer', async () => {
    const ipc = client();
    const before = await ipc.authorMr(PROJECT, IID);
    const body = 'Only the count is lost. Zażółć gęślą jaźń.';

    await expect(ipc.authorReply(PROJECT, IID, QUESTION, body)).resolves.toBeUndefined();

    const after = await ipc.authorMr(PROJECT, IID);
    const thread = after.threads.find((t) => t.id === QUESTION);
    if (!thread) throw new Error('the question is listed');
    expect(thread.status).toBe('answered');
    expect(thread.notes).toHaveLength(2);
    expect(thread.notes[1]).toMatchObject({
      author: 'Bartek K.',
      avatar: 'BK',
      body,
      mine: true,
    });
    expect(after.toAnswer).toBe(before.toAnswer - 1);
    // Immediate: nothing is waiting for a push, the other thread is untouched.
    expect(after.waiting).toEqual(before.waiting);
    expect(after.threads.find((t) => t.id === CHANGE)).toEqual(
      before.threads.find((t) => t.id === CHANGE),
    );
    expect(after.resolved).toEqual(before.resolved);
  });

  it('F-26.7 the body is sent as written, not trimmed', async () => {
    const ipc = client();
    await ipc.authorReply(PROJECT, IID, QUESTION, '  Line one\n\nLine two  ');

    const mr = await ipc.authorMr(PROJECT, IID);
    expect(mr.threads.find((t) => t.id === QUESTION)?.notes[1]?.body).toBe(
      '  Line one\n\nLine two  ',
    );
  });

  it('F-26.7 an empty or blank body is INVALID_INPUT and sends nothing', async () => {
    const ipc = client();
    const before = await ipc.authorMr(PROJECT, IID);

    for (const body of ['', '   \n']) {
      await expect(ipc.authorReply(PROJECT, IID, QUESTION, body)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        message: 'Write the reply to send.',
      });
    }
    expect((await ipc.authorMr(PROJECT, IID)).threads).toEqual(before.threads);
  });

  it('F-26.7 a discussion the MR does not have is GITLAB_NOT_FOUND', async () => {
    await expect(client().authorReply(PROJECT, IID, 'no-such-thread', 'Hi')).rejects.toMatchObject({
      code: 'GITLAB_NOT_FOUND',
      message: "GitLab didn't find it.",
    });
  });
});
