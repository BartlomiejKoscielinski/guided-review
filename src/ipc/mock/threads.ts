import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabUser } from '../types/GitlabUser';
import type { Thread } from '../types/Thread';
import type { MockSessionData } from './session-data';

type ThreadActions = Pick<IpcClient, 'gitlabDiscussions' | 'gitlabResolve' | 'gitlabReply'>;

const invalid = (message: string) =>
  new IpcError({ code: 'INVALID_INPUT', message, retryable: false });

/**
 * !482's threads (F-12.2), and Resolve, Reopen and Reply on them (F-11.2), as
 * `commands/gitlab_threads.rs` answers:
 * the same guards in the same order (a session without an MR, a blank reply, no GitLab account,
 * an unknown discussion), and a failed call changes nothing. Every MR session of the mock reviews
 * !482, so they share its threads (`SessionData.threads`, the mock GitLab's state). A reply is a
 * note of the thread under the signed-in user, never a draft.
 */
export function createThreadActions(
  store: MockSessionData,
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
): ThreadActions {
  const { data } = store;
  const target = (sessionId: string, discussion: string, body?: string): Thread => {
    if (data.local.includes(sessionId)) throw invalid('The session has no merge request.');
    if (body?.trim() === '') throw invalid('The reply is empty.');
    if (!user()) throw unauthorized();
    const thread = data.threads.find((t) => t.id === discussion);
    if (!thread) {
      throw new IpcError({
        code: 'GITLAB_NOT_FOUND',
        message: "GitLab didn't find it.",
        retryable: false,
      });
    }
    return thread;
  };
  const settle = (act: () => void): Promise<void> => {
    try {
      act();
      store.save();
      return respond(undefined);
    } catch (e: unknown) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  };
  return {
    gitlabDiscussions: (sessionId) => {
      if (data.local.includes(sessionId)) {
        return Promise.reject(invalid('The session has no merge request.'));
      }
      if (!user()) return Promise.reject(unauthorized());
      return respond(data.threads);
    },
    gitlabResolve: (sessionId, discussion, resolved) =>
      settle(() => {
        target(sessionId, discussion).resolved = resolved;
      }),
    gitlabReply: (sessionId, discussion, body) =>
      settle(() => {
        const thread = target(sessionId, discussion, body);
        const author = user();
        if (!author) throw unauthorized();
        const ids = data.threads.flatMap((t) => t.notes.map((n) => n.id));
        thread.notes.push({
          id: Math.max(0, ...ids) + 1,
          author: { ...author },
          body,
          createdAt: new Date().toISOString(),
        });
      }),
  };
}
