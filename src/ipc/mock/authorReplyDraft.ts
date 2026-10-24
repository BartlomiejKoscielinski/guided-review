import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import { authorMr } from './fixtures/authorMr';

/** The answer Author.dc.html's "Draft with Claude" fills for Piotr S.'s question. */
export const REPLY_DRAFT =
  'Nothing is lost: the photo stays in the SQLite queue until it’s sent. Only the attempt count is in memory, so after a restart the backoff starts again from 2 s. That felt acceptable, but I can persist it if you prefer.';

/** Author.dc.html's "Drafting…" lasts a second. */
const DRAFT_MS = 1000;

const notFound = () =>
  new IpcError({ code: 'GITLAB_NOT_FOUND', message: "GitLab didn't find it.", retryable: false });

/**
 * `claudeReplyDraft` (F-26.7) as `commands/author_reply.rs` answers it: a discussion the MR doesn't
 * have is GitLab's 404, any other gets the mock's proposed answer after about a second. Nothing is
 * sent and no thread changes.
 */
export function createReplyDraftBackend(
  respond: <T>(value: T) => Promise<T>,
  pause: (ms: number) => Promise<void>,
): Pick<IpcClient, 'claudeReplyDraft'> {
  return {
    claudeReplyDraft: async (_project, _iid, discussion) => {
      if (!authorMr().threads.some((t) => t.id === discussion)) throw notFound();
      await pause(DRAFT_MS);
      return respond({ reply: REPLY_DRAFT });
    },
  };
}
