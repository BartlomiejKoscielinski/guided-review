import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { CommitList } from '../types/CommitList';
import type { DetectedSource } from '../types/DetectedSource';
import type { Layout } from '../types/Layout';
import type { OpenedSession } from '../types/OpenedSession';
import type { Route } from '../types/Route';
import { BRANCH } from './fixtures/changes';
import { BRANCHES, branchCommits, STATUS_SUMMARY } from './fixtures/sources';
import { MOCK_SERVER } from './gitlab';
import type { MockRepos } from './repos';
import { stateOf, type MockSessionData } from './session-data';

type SourcesClient = Pick<
  IpcClient,
  | 'repoList'
  | 'repoSwitch'
  | 'repoSetDefault'
  | 'repoRemove'
  | 'sourceDetect'
  | 'gitLog'
  | 'gitStatusSummary'
  | 'sessionOpenCommit'
  | 'sessionOpenLocal'
  | 'sessionOpenBranch'
  | 'sessionOpenRepo'
>;

const invalid = (message: string) =>
  new IpcError({ code: 'INVALID_INPUT', message, retryable: false });
const noMatch = (input: string) => invalid(`No commit, branch or repository matches “${input}”.`);

const MR_PATH = /^\/(.+?)\/-\/merge_requests\/(\d+)(?:[/?#]|$)/;
const HEX = /^[0-9a-f]{7,40}$/i;
const WINDOWS_PATH = /^(?:[A-Za-z]:\\|\\\\)/;

/**
 * The S-01 sources part of the mock backend: detection, commits, scope counts, sessions (kept in
 * `store`, in the layout `ui.focusLayout` names).
 */
export function createSourcesBackend(
  respond: <T>(value: T) => Promise<T>,
  repos: MockRepos,
  store: MockSessionData,
  focusLayout: () => Layout,
): SourcesClient {
  const commits = branchCommits();
  const head = commits[0]?.sha ?? '';
  const { data } = store;
  const requireRepo = () => {
    if (!repos.active()) throw invalid('Pick a repository first.');
  };
  const opened = (route: (sessionId: string) => Route): Promise<OpenedSession> => {
    data.localCount += 1;
    const sessionId = `mock-session-${String(data.localCount)}`;
    data.local.push(sessionId);
    stateOf(data, sessionId).layout = focusLayout();
    store.save();
    return respond({ sessionId, route: route(sessionId) });
  };
  const plan = (sessionId: string): Route => ({ screen: 'S-02', sessionId });

  const detectUrl = (input: string): DetectedSource => {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw noMatch(input);
    }
    const match = MR_PATH.exec(url.pathname);
    if (!match) throw noMatch(input);
    if (url.host.toLowerCase() !== new URL(MOCK_SERVER).host) {
      throw invalid(`${url.host} is not the configured GitLab server.`);
    }
    const project = match[1] ?? '';
    const repo = repos.byProject(project);
    if (!repo?.gitlabProject) {
      throw invalid(`${project} is not one of your repositories. Add it in Settings › GitLab.`);
    }
    return { kind: 'mr', project: repo.gitlabProject, iid: Number(match[2]), repoId: repo.id };
  };

  const detect = (input: string): DetectedSource => {
    if (/^https?:\/\//.test(input)) return detectUrl(input);
    const iid = /^!(\d+)$/.exec(input);
    if (iid && Number(iid[1]) > 0) {
      requireRepo();
      const repo = repos.list().find((r) => r.isActive);
      if (!repo?.gitlabProject) {
        throw invalid("The repository's origin isn't a project on the configured GitLab server.");
      }
      return { kind: 'mr', project: repo.gitlabProject, iid: Number(iid[1]), repoId: repo.id };
    }
    const path = input.replace(/^"|"$/g, '');
    if (WINDOWS_PATH.test(path)) {
      const lower = path.toLowerCase().replace(/\\+$/, '');
      const repo = repos
        .list()
        .find(
          (r) => lower === r.path.toLowerCase() || lower.startsWith(`${r.path.toLowerCase()}\\`),
        );
      if (repo) return { kind: 'repository', name: repo.name, path: repo.path, repoId: repo.id };
      const name = lower.split('\\').filter(Boolean).at(-1);
      if (!name || !lower.startsWith('c:\\src\\')) throw noMatch(input);
      return { kind: 'repository', name: path.split('\\').filter(Boolean).at(-1) ?? name, path };
    }
    requireRepo();
    if (HEX.test(input)) {
      const commit = commits.find((c) => c.sha.startsWith(input.toLowerCase()));
      if (commit) return { kind: 'commit', sha: commit.sha, shortSha: commit.shortSha };
    }
    const local = BRANCHES.find((b) => b === input);
    if (local) {
      return {
        kind: 'branch',
        name: local,
        sha: head,
        remote: false,
        current: local === BRANCH,
      };
    }
    const remote = BRANCHES.find((b) => `origin/${b}` === input);
    if (remote) {
      return { kind: 'branch', name: input, sha: head, remote: true, current: false };
    }
    throw noMatch(input);
  };

  return {
    repoList: async () => respond(repos.list()),
    repoSwitch: async (id) => respond(repos.switchTo(id)),
    repoSetDefault: async (id) => {
      repos.setDefault(id);
      return respond(undefined);
    },
    repoRemove: async (id) => {
      repos.remove(id);
      return respond(undefined);
    },
    sourceDetect: async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return respond(null);
      return respond(detect(trimmed));
    },
    gitLog: async (branch, query) => {
      requireRepo();
      if (branch !== undefined && !BRANCHES.includes(branch)) {
        throw invalid(`There is no branch ${branch}.`);
      }
      const q = query?.trim().toLowerCase() ?? '';
      const list: CommitList = {
        branch: branch ?? BRANCH,
        commits: q
          ? commits.filter(
              (c) =>
                c.subject.toLowerCase().includes(q) ||
                c.author.toLowerCase().includes(q) ||
                (q.length >= 4 && c.sha.startsWith(q)),
            )
          : commits,
      };
      return respond(list);
    },
    gitStatusSummary: async () => {
      requireRepo();
      return respond(STATUS_SUMMARY);
    },
    sessionOpenCommit: async (range) => {
      requireRepo();
      const known = (sha: string) => commits.some((c) => c.sha.startsWith(sha.toLowerCase()));
      if (!known(range.to)) throw noMatch(range.to);
      // A Shift+click range starts at the parent of its oldest commit, maybe below the list.
      const parent = (sha: string) => commits.some((c) => c.parent === sha.toLowerCase());
      if (range.from !== undefined && !known(range.from) && !parent(range.from)) {
        throw noMatch(range.from);
      }
      return opened(plan);
    },
    sessionOpenLocal: async () => {
      requireRepo();
      return opened(plan);
    },
    sessionOpenBranch: async (branch) => {
      requireRepo();
      const name = branch.replace(/^origin\//, '');
      if (!BRANCHES.includes(name)) throw noMatch(branch);
      // Another branch is a commits session, the current one a local one: both open S-02 (F-17.1).
      return opened(plan);
    },
    sessionOpenRepo: async (path) => {
      const detected = detect(path.trim());
      if (detected.kind !== 'repository') throw noMatch(path.trim());
      repos.add(detected.name, detected.path);
      return opened(plan);
    },
  };
}
