import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { AuthorMr } from '../types/AuthorMr';
import type { QueuedReply } from '../types/QueuedReply';
import { authorMr } from './fixtures/authorMr';

interface Row extends QueuedReply {
  project: string;
  iid: number;
}

const notQueued = () =>
  new IpcError({ code: 'INVALID_INPUT', message: "That reply isn't queued.", retryable: false });

/**
 * F-26.5 as `commands/author.rs` answers it: `authorQueueReply` keeps one open reply per thread of
 * an MR (queueing again replaces its text, switch and commit, same ID) and sends nothing;
 * `authorPushAndReply` is `pullFirst` under the scenario `pushFails: 'rejected'` (the remote has
 * commits you don't have, as `gitPush` there), else the push and the reply go through: done on
 * origin/<source branch>. `withQueued` gives `authorMr`'s threads with a reply not sent yet the
 * status `fixedLocally` and lists them in `waiting`, as the core reads `queued_replies`; the
 * mock remote never holds a commit whose reply waits, so each is `pushed: false`.
 */
export function createAuthorPushBackend(
  pushFails: () => boolean,
  respond: <T>(value: T) => Promise<T>,
): Pick<IpcClient, 'authorQueueReply' | 'authorPushAndReply'> & {
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
      if (body.trim() === '') {
        return Promise.reject(
          new IpcError({
            code: 'INVALID_INPUT',
            message: 'Write the reply to send.',
            retryable: false,
          }),
        );
      }
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
    withQueued: (project, mr) => {
      const queued = new Set(
        [...rows.values()]
          .filter((r) => r.project === project && r.iid === mr.iid && r.state === 'queued')
          .map((r) => r.discussion),
      );
      const waiting = [...rows.values()]
        .filter((r) => r.project === project && r.iid === mr.iid && r.state === 'queued')
        .map((r) => ({ reply: view(r), pushed: false }));
      return {
        ...mr,
        waiting,
        threads: mr.threads.map((t) =>
          queued.has(t.id) ? { ...t, status: 'fixedLocally' as const } : t,
        ),
      };
    },
  };
}
