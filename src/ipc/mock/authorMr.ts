import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabUser } from '../types/GitlabUser';
import type { MrRow } from '../types/MrRow';
import { AUTHOR_MR, authorMr } from './fixtures/authorMr';

const notMine = () =>
  new IpcError({
    code: 'INVALID_INPUT',
    message: 'This merge request isn’t yours.',
    retryable: false,
  });

const notFound = () =>
  new IpcError({ code: 'GITLAB_NOT_FOUND', message: "GitLab didn't find it.", retryable: false });

/**
 * `authorMr` (F-26.1) as `commands/author.rs` answers it: no GitLab account first, then an MR of
 * the lists that someone else wrote is INVALID_INPUT, my !480 is `fixtures/authorMr.ts`, any other
 * is GitLab's 404.
 */
export function createAuthorBackend(
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
  listed: (iid: number) => MrRow | undefined,
): Pick<IpcClient, 'authorMr'> {
  const loadedAt = new Date();
  return {
    authorMr: (_project, iid) => {
      const me = user();
      if (!me) return Promise.reject(unauthorized());
      const row = listed(iid);
      if (row && row.author.username !== me.username) return Promise.reject(notMine());
      if (iid !== AUTHOR_MR) return Promise.reject(notFound());
      return respond(authorMr(loadedAt));
    },
  };
}
