import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { AuthorMr } from '../types/AuthorMr';
import type { CreatedMr } from '../types/CreatedMr';
import type { ExistingMr } from '../types/ExistingMr';
import type { GitlabStatus } from '../types/GitlabStatus';
import { mockTarget } from './branchInfo';
import { BRANCH } from './fixtures/changes';
import { MOCK_SERVER } from './gitlab';
import type { MockRepos } from './repos';
import { notConnected } from './reviewers';

/** The number GitLab gives the new MR in CreateMR.dc.html. */
export const CREATED_IID = 483;
/** Its head pipeline, running right away. */
const CREATED_PIPELINE = 18361;
const DRAFT = 'Draft: ';
/** The GitLab project of the mock repository (mobile-app) that holds the branch. */
const PROJECT = 'mobile/mobile-app';

const conflict = (iid: number) =>
  new IpcError({
    code: 'CONFLICT',
    message: `Another open merge request already exists for this source branch: !${String(iid)}`,
    retryable: false,
  });

/** What the mock knows once Create has run: the MR and its target. */
interface Made {
  created: CreatedMr;
  target: string;
}

/**
 * `gitlab_create_mr` (F-27.6) of the mock with the core's guards: a GitLab account first, then a
 * target that is a branch on origin (`mockTarget`), then GitLab's own refusals (an open MR of the
 * branch is CONFLICT, a blank title is 422 "title can't be blank"). The created MR is the open MR
 * of the branch afterwards (`existingMr`) and my MR for S-10 (`authorMr`).
 */
export function createCreateMrBackend(
  respond: <T>(value: T) => Promise<T>,
  repos: MockRepos,
  status: () => Promise<GitlabStatus>,
  scenarioMr: ExistingMr | undefined,
) {
  let made: Made | null = null;
  const gitlabCreateMr: IpcClient['gitlabCreateMr'] = async (request) => {
    const current = await status();
    if (current.state !== 'connected' || current.user === null) throw notConnected(current);
    const { target } = mockTarget(repos, request.target);
    const open = made?.created ?? scenarioMr;
    if (open !== undefined) throw conflict(open.iid);
    if (request.title.trim() === '') {
      throw new IpcError({
        code: 'INVALID_INPUT',
        message: "title can't be blank",
        retryable: false,
      });
    }
    const title =
      request.draft && !request.title.startsWith(DRAFT)
        ? `${DRAFT}${request.title}`
        : request.title;
    const created: CreatedMr = {
      iid: CREATED_IID,
      title,
      webUrl: `${MOCK_SERVER}/${PROJECT}/-/merge_requests/${String(CREATED_IID)}`,
      pipeline: { id: CREATED_PIPELINE, status: 'running' },
    };
    made = { created, target };
    return respond({ ...created });
  };
  return {
    gitlabCreateMr,
    /** The open MR of the branch: the one created here, else the scenario's. */
    existingMr: (): ExistingMr | undefined =>
      made === null ? scenarioMr : { iid: made.created.iid, title: made.created.title },
    /** My MR !483 once it is created: no threads yet and its pipeline running. */
    authorMr: async (iid: number): Promise<AuthorMr | undefined> => {
      if (made === null || iid !== made.created.iid) return undefined;
      const current = await status();
      if (current.state !== 'connected' || current.user === null) throw notConnected(current);
      const now = new Date().toISOString();
      return respond<AuthorMr>({
        iid,
        title: made.created.title,
        sourceBranch: BRANCH,
        targetBranch: made.target,
        pipeline: {
          status: 'running',
          allowedFailures: 0,
          number: CREATED_PIPELINE,
          kind: 'Merge request pipeline',
          sha: '4c1f9e2b7a0d3c6f9e2b5a8d1c4f7e0b3a6d9c2f',
          version: 1,
          author: 'Bartek K.',
          startedByMe: true,
          startedAt: now,
          durationSecs: null,
          webUrl: `${MOCK_SERVER}/${PROJECT}/-/pipelines/${String(CREATED_PIPELINE)}`,
        },
        threads: [],
        toAnswer: 0,
        resolved: { count: 0, firstExcerpt: null },
        waiting: [],
        onSourceBranch: true,
      });
    },
  };
}
