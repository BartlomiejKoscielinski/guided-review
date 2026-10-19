import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { GitlabStatus } from '../types/GitlabStatus';
import type { MrList } from '../types/MrList';
import type { MrRow } from '../types/MrRow';
import type { MrTab } from '../types/MrTab';
import { createApprovalActions, type ApprovalScenario } from './approvals';
import type { MockSessionData } from './session-data';
import { createBrowserBackend } from './browser';
import { createPipelineBackend } from './pipeline';
import { createPublishActions, type PublishScenario } from './publish';
import { createThreadActions } from './threads';

/** Variations of the GitLab part of the mock (`MOCK_GITLAB_KEY`). */
export interface GitlabScenario extends PublishScenario, ApprovalScenario {
  /** The status at start: connected (default), no token yet, or a failing token. */
  state?: GitlabStatus['state'];
}

type GitlabClient = Pick<
  IpcClient,
  | 'gitlabStatus'
  | 'gitlabAccountSave'
  | 'gitlabAccountRemove'
  | 'gitlabListMrs'
  | 'gitlabDiscussions'
  | 'gitlabApprovalState'
  | 'summaryStatus'
  | 'gitlabApprove'
  | 'gitlabUnapprove'
  | 'gitlabResolve'
  | 'gitlabReply'
  | 'pipelineList'
  | 'pipelineGet'
  | 'pipelineJobs'
  | 'jobRetry'
  | 'jobCancel'
  | 'pipelineMrHead'
  | 'pipelineRunMr'
  | 'pipelineRetry'
  | 'pipelineCancel'
  | 'osOpenGitlabUrl'
  | 'draftsPublish'
  | 'gitlabForeignDrafts'
>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** An ISO time `ms` before now. */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

/** Local `YYYY-MM-DD` `days` from today (Settings.dc.html: "expires in 41 days"). */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Settings.dc.html › GitLab. */
export const MOCK_SERVER = 'https://gitlab.local';
const CONNECTED: GitlabStatus = {
  state: 'connected',
  server: MOCK_SERVER,
  user: { username: 'bartek.k', name: 'Bartek K.' },
  tokenMasked: 'glpat-…3f9a',
  scopes: ['api'],
  expiresAt: inDays(41),
  problem: null,
};

function row(
  iid: number,
  title: string,
  author: string,
  age: number,
  [additions, deletions, files]: [number, number, number],
  passed: boolean,
  note: string | null,
  extra: Partial<MrRow> = {},
): MrRow {
  const username = author
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/\.$/, '');
  return {
    iid,
    title,
    draft: false,
    webUrl: `${MOCK_SERVER}/mobile/mobile-app/-/merge_requests/${String(iid)}`,
    author: { username, name: author },
    mine: false,
    createdAt: ago(age),
    updatedAt: ago(age),
    headSha: String(iid).padStart(40, 'f'),
    additions,
    deletions,
    files,
    pipeline: passed ? 'passed' : 'failed',
    unresolvedThreads: 0,
    reviewer: false,
    approved: false,
    note,
    planReady: false,
    ...extra,
  };
}

const REVIEWER = { reviewer: true };

/** Start.dc.html's lists (the counts are the mock's, All open shows its first rows). */
function lists(): Record<MrTab, MrRow[]> {
  // Waiting for me's !482 has its plan cached; the row adds " · plan is ready" (F-02.5).
  const offline = (note: string | null, planReady: boolean) =>
    row(482, 'Offline queue for delivery photos', 'Marta K.', 2 * HOUR, [462, 61, 16], true, note, {
      ...REVIEWER,
      planReady,
    });
  const retry = (note: string | null) =>
    row(
      480,
      'Retry in UploadWorker after network loss',
      'Bartek K.',
      DAY,
      [77, 15, 4],
      true,
      note,
      {
        mine: true,
        author: { username: 'bartek.k', name: 'Bartek K.' },
        unresolvedThreads: 2,
      },
    );
  return {
    waiting: [
      offline('You’re a reviewer', true),
      row(
        479,
        'Crash when rotating the signature screen',
        'Paweł S.',
        5 * HOUR,
        [34, 20, 3],
        true,
        null,
        REVIEWER,
      ),
      row(
        475,
        'Migrate to .NET 10',
        'Kuba W.',
        DAY,
        [1204, 987, 61],
        false,
        'Large: the plan splits it by layer',
        REVIEWER,
      ),
    ],
    mine: [retry('2 unresolved threads from reviewers')],
    all: [
      offline(null, false),
      row(481, 'Dark theme: button colors', 'Ola M.', 4 * HOUR, [58, 40, 6], true, null),
      retry(null),
    ],
  };
}

/** An MR of the mock lists by iid (what `gitlab_mr` would find), for preparation. */
export function findMockMr(iid: number): MrRow | undefined {
  return Object.values(lists())
    .flat()
    .find((mr) => mr.iid === iid);
}

const COUNTS = { waiting: 3, mine: 1, all: 12 };

function addToken(): IpcError {
  return new IpcError({
    code: 'GITLAB_UNAUTHORIZED',
    message: 'Add a GitLab token in Settings › GitLab.',
    retryable: false,
  });
}

/** Last 4 characters behind the token's prefix, like the core's mask (T4). */
function mask(token: string): string {
  const prefix = /^(glpat-|gloas-|gldt-)/.exec(token)?.[1] ?? '';
  const rest = token.slice(prefix.length);
  return `${prefix}…${rest.length >= 8 ? rest.slice(-4) : ''}`;
}

/** The GitLab part of the mock backend (Settings.dc.html and Start.dc.html). */
export function createGitlabBackend(
  scenario: GitlabScenario,
  respond: <T>(value: T) => Promise<T>,
  store: MockSessionData,
): GitlabClient {
  let status: GitlabStatus =
    scenario.state === 'noToken'
      ? {
          ...CONNECTED,
          state: 'noToken',
          user: null,
          tokenMasked: null,
          scopes: [],
          expiresAt: null,
        }
      : scenario.state === 'failing'
        ? {
            ...CONNECTED,
            state: 'failing',
            user: null,
            scopes: [],
            expiresAt: null,
            problem: {
              code: 'GITLAB_UNAUTHORIZED',
              message:
                'The GitLab token has expired. Create a new one and replace it in Settings › GitLab.',
              retryable: false,
            },
          }
        : CONNECTED;
  const signedIn = () => (status.state === 'connected' ? status.user : null);
  return {
    gitlabStatus: () => respond(status),
    gitlabAccountSave: (server, token) => {
      const trimmed = token.trim();
      if (!server.trim() || !trimmed) {
        return Promise.reject(
          new IpcError({
            code: 'INVALID_INPUT',
            message: server.trim()
              ? 'Paste the whole personal access token.'
              : 'Enter the GitLab server URL.',
            retryable: false,
          }),
        );
      }
      status = {
        ...CONNECTED,
        server: server.trim().replace(/\/+$/, ''),
        tokenMasked: mask(trimmed),
      };
      return respond(status);
    },
    gitlabAccountRemove: () => {
      status = {
        ...status,
        state: 'noToken',
        user: null,
        tokenMasked: null,
        scopes: [],
        expiresAt: null,
        problem: null,
      };
      return respond(status);
    },
    gitlabListMrs: (tab) => {
      if (status.state !== 'connected') return Promise.reject(addToken());
      const list: MrList = { tab, rows: lists()[tab], counts: COUNTS, truncated: false };
      return respond(list);
    },
    ...createThreadActions(store, signedIn, addToken, respond),
    ...createApprovalActions(store, scenario, signedIn, addToken, respond),
    ...createPublishActions(store, scenario, signedIn, addToken, respond),
    ...createPipelineBackend(signedIn, addToken, respond),
    ...createBrowserBackend(() => status.server, respond),
  };
}
