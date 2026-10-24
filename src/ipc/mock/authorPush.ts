import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { AuthorMr } from '../types/AuthorMr';
import type { AuthorNote } from '../types/AuthorNote';
import type { AuthorThread } from '../types/AuthorThread';
import type { QueuedReply } from '../types/QueuedReply';
import type { ThreadStatus } from '../types/ThreadStatus';
import { authorMr } from './fixtures/authorMr';

interface Row extends QueuedReply {
  project: string;
  iid: number;
}

const blank = () =>
  new IpcError({ code: 'INVALID_INPUT', message: 'Write the reply to send.', retryable: false });

const notFound = () =>
  new IpcError({ code: 'GITLAB_NOT_FOUND', message: "GitLab didn't find it.", retryable: false });

const notQueued = () =>
  new IpcError({ code: 'INVALID_INPUT', message: "That reply isn't queued.", retryable: false });

/**
 * F-26.5 as `commands/author.rs` answers it: `authorQueueReply` keeps one open reply per thread of
 * an MR (queueing again replaces its text, switch and commit, same ID) and sends nothing;
 * `authorPushAndReply` is `pullFirst` under the scenario `pushFails: 'rejected'` (the remote has
 * commits you don't have, as `gitPush` there), else the push and the reply go through: done on
 * origin/<source branch>. `withQueued` gives `authorMr`'s threads with a reply not sent yet the
 * status `fixedLocally` and lists them in `waiting`, as the core reads `queued_replies`; the
 * mock remote never holds a commit whose reply waits, so each is `pushed: false`. A sent reply
 * (F-26.6) is the last note of its thread, mine: with Resolve the thread leaves the open list and
 * counts as resolved; without it the thread reads `replied` (`answered` for a question) and no
 * longer waits for an answer. `authorReply` (F-26.7, Send reply on a question) is such a sent
 * reply at once, as written, without Resolve: a blank body is INVALID_INPUT, a discussion the MR
 * doesn't have GitLab's 404, as `commands/author_reply.rs`.
 */
export function createAuthorPushBackend(
  pushFails: () => boolean,
  respond: <T>(value: T) => Promise<T>,
): Pick<IpcClient, 'authorQueueReply' | 'authorPushAndReply' | 'authorReply'> & {
  withQueued: (project: string, mr: AuthorMr) => AuthorMr;
} {
  const rows = new Map<string, Row>();
  let next = 1;
  const view = (row: Row): QueuedReply => ({
    id: row.id,
    discussion: row.discussion,
    body: row.body,
    resolve: row.resolve,
    afterSha: row.afterSha,
    state: row.state,
    error: row.error,
  });
  return {
    authorQueueReply: (project, iid, discussion, body, resolve, afterSha) => {
      if (body.trim() === '') return Promise.reject(blank());
      const open = [...rows.values()].find(
        (r) =>
          r.project === project &&
          r.iid === iid &&
          r.discussion === discussion &&
          r.state === 'queued',
      );
      const id = open?.id ?? `queued-reply-${String(next++)}`;
      const row: Row = {
        id,
        project,
        iid,
        discussion,
        body,
        resolve,
        afterSha,
        state: 'queued',
        error: null,
      };
      rows.set(id, row);
      return respond(view(row));
    },
    authorPushAndReply: (project, iid, id) => {
      const row = rows.get(id);
      if (!row || row.project !== project || row.iid !== iid) return Promise.reject(notQueued());
      if (pushFails()) return respond({ kind: 'pullFirst' as const });
      rows.set(id, { ...row, state: 'sent', error: null });
      return respond({
        kind: 'done' as const,
        remoteBranch: `origin/${authorMr().sourceBranch}`,
        resolved: row.resolve,
      });
    },
    authorReply: async (project, iid, discussion, body) => {
      if (body.trim() === '') throw blank();
      if (!authorMr().threads.some((t) => t.id === discussion)) throw notFound();
      const id = `sent-reply-${String(next++)}`;
      rows.set(id, {
        id,
        project,
        iid,
        discussion,
        body,
        resolve: false,
        afterSha: '',
        state: 'sent',
        error: null,
      });
      await respond(null);
    },
    withQueued: (project, mr) => {
      const mine = [...rows.values()].filter((r) => r.project === project && r.iid === mr.iid);
      const queued = new Set(mine.filter((r) => r.state === 'queued').map((r) => r.discussion));
      const sent = new Map(mine.filter((r) => r.state === 'sent').map((r) => [r.discussion, r]));
      const waiting = mine
        .filter((r) => r.state === 'queued')
        .map((r) => ({ reply: view(r), pushed: false }));
      return withSent(
        {
          ...mr,
          waiting,
          threads: mr.threads.map((t) =>
            queued.has(t.id) ? { ...t, status: 'fixedLocally' as const } : t,
          ),
        },
        sent,
      );
    },
  };
}

const ANSWERED: readonly ThreadStatus[] = ['replied', 'answered'];

/** The threads after their replies in `sent` went out (F-26.6), as GitLab then lists them. */
function withSent(mr: AuthorMr, sent: Map<string, Row>): AuthorMr {
  let toAnswer = mr.toAnswer;
  let resolved = mr.resolved.count;
  const threads: AuthorThread[] = [];
  for (const thread of mr.threads) {
    const reply = sent.get(thread.id);
    if (!reply) {
      threads.push(thread);
      continue;
    }
    if (!ANSWERED.includes(thread.status)) toAnswer -= 1;
    if (reply.resolve) {
      resolved += 1;
      continue;
    }
    const note: AuthorNote = {
      author: ME.name,
      avatar: ME.avatar,
      body: reply.body,
      createdAt: new Date().toISOString(),
      mine: true,
    };
    threads.push({
      ...thread,
      status: thread.kind === 'question' ? 'answered' : 'replied',
      notes: [...thread.notes, note],
    });
  }
  return {
    ...mr,
    threads,
    toAnswer: Math.max(0, toAnswer),
    resolved: { ...mr.resolved, count: resolved },
  };
}

/** The mock's signed-in user (`gitlab.ts`), who sends the replies. */
const ME = { name: 'Bartek K.', avatar: 'BK' };
