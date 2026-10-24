import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabUser } from '../types/GitlabUser';
import type { MrRow } from '../types/MrRow';
import type { PipelineTab } from '../types/PipelineTab';
import { toFileDiff } from './diff';
import { AUTHOR_MR, authorMr, FIXUP_TARGET, UPLOAD_WORKER_DIFF } from './fixtures/authorMr';
import { layerOf } from './layer';

/**
 * S-10 variations (F-26.8): `onSourceBranch: false` puts the user's checkout on another branch, so
 * author mode is read only. The default is the checkout on !480's source branch.
 */
export interface AuthorScenario {
  onSourceBranch?: boolean;
  /**
   * The checkout's uncommitted files (M7 decision 10); none by default, so S-10 shows no "You have
   * other uncommitted changes." warning unless a test or dev:mock asks for it.
   */
  uncommitted?: string[];
}

/**
 * `authorUncommittedFiles` as `commands/author.rs` answers it: the active repository's
 * uncommitted files, from the scenario; no active repository is INVALID_INPUT.
 */
export function authorUncommittedFiles(
  scenario: AuthorScenario,
  hasRepo: () => boolean,
  respond: <T>(value: T) => Promise<T>,
): Promise<string[]> {
  if (!hasRepo()) {
    return Promise.reject(
      new IpcError({
        code: 'INVALID_INPUT',
        message: 'Pick a repository first.',
        retryable: false,
      }),
    );
  }
  return respond([...(scenario.uncommitted ?? [])]);
}

const notMine = () =>
  new IpcError({
    code: 'INVALID_INPUT',
    message: 'This merge request isn’t yours.',
    retryable: false,
  });

/** The pipeline GitLab starts for the pushed fix (Author.dc.html: "Pipeline #18360 running"). */
const PUSHED_PIPELINE: PipelineTab = {
  id: 18360,
  number: 18360,
  sha: '',
  version: 2,
  latest: true,
  status: 'running',
};

const notFound = () =>
  new IpcError({ code: 'GITLAB_NOT_FOUND', message: "GitLab didn't find it.", retryable: false });

/**
 * `authorMr` (F-26.1) as `commands/author.rs` answers it: no GitLab account first, then an MR of
 * the lists that someone else wrote is INVALID_INPUT, my !480 is `fixtures/authorMr.ts`, any other
 * is GitLab's 404. `authorFileDiff` (F-26.2) reads the checkout, not GitLab: UploadWorker.cs is
 * the fixture's diff, any other file is one the author didn't change (no hunks).
 * `authorFixupTarget` (F-26.4) reads git: any thread's fix is a fixup of b71e3a0 (Author.dc.html).
 * `authorPushPipeline` (F-26.6) stands in for GitLab starting the pipeline of a pushed commit
 * asynchronously: the first lookup of a sha finds none yet, a later one #18360 running, which is
 * then the MR's head pipeline in `authorMr` too (the title bar's chip, Author.dc.html).
 */
export function createAuthorBackend(
  user: () => GitlabUser | null,
  unauthorized: () => IpcError,
  respond: <T>(value: T) => Promise<T>,
  listed: (iid: number) => MrRow | undefined,
): Pick<IpcClient, 'authorMr' | 'authorFileDiff' | 'authorFixupTarget' | 'authorPushPipeline'> {
  const loadedAt = new Date();
  const lookups = new Map<string, number>();
  /** The MRs whose pushed pipeline was found, with its sha: their head pipeline is #18360. */
  const started = new Map<number, string>();
  return {
    authorMr: (_project, iid) => {
      const me = user();
      if (!me) return Promise.reject(unauthorized());
      const row = listed(iid);
      if (row && row.author.username !== me.username) return Promise.reject(notMine());
      if (iid !== AUTHOR_MR) return Promise.reject(notFound());
      const mr = authorMr(loadedAt);
      const sha = started.get(iid);
      if (sha === undefined || !mr.pipeline) return respond(mr);
      return respond({
        ...mr,
        pipeline: { ...mr.pipeline, status: 'running', number: 18360, sha, durationSecs: null },
      });
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
    authorFixupTarget: () => respond({ ...FIXUP_TARGET }),
    authorPushPipeline: (project, iid, sha) => {
      if (!user()) return Promise.reject(unauthorized());
      const key = `${project}!${String(iid)}@${sha}`;
      const asked = (lookups.get(key) ?? 0) + 1;
      lookups.set(key, asked);
      if (asked === 1 || sha === '') return respond(null);
      started.set(iid, sha);
      return respond({ ...PUSHED_PIPELINE, sha });
    },
  };
}
