import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabUser } from '../types/GitlabUser';
import type { MrRow } from '../types/MrRow';
import { toFileDiff } from './diff';
import { AUTHOR_MR, authorMr, UPLOAD_WORKER_DIFF } from './fixtures/authorMr';
import { layerOf } from './layer';

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
 * is GitLab's 404. `authorFileDiff` (F-26.2) reads the checkout, not GitLab: UploadWorker.cs is
 * the fixture's diff, any other file is one the author didn't change (no hunks).
 */
export function createAuthorBackend(
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
  listed: (iid: number) => MrRow | undefined,
): Pick<IpcClient, 'authorMr' | 'authorFileDiff'> {
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
    authorFileDiff: (_target, path) =>
      respond(
        path === UPLOAD_WORKER_DIFF.path
          ? toFileDiff(UPLOAD_WORKER_DIFF)
          : {
              newPath: path,
              status: 'modified',
              binary: false,
              additions: 0,
              deletions: 0,
              layer: layerOf(path),
              lineStaging: false,
              hunks: [],
            },
      ),
  };
}
