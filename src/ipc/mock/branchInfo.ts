import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { BranchInfo } from '../types/BranchInfo';
import { BRANCH } from './fixtures/changes';
import type { MockRepos } from './repos';

/** The default target first, as the core orders `origin/*` (F-27.1). */
const TARGETS = ['develop', 'main', 'release/1.8'];

/** Per target: commits, files, +, − (develop = CreateMR.dc.html). */
const COUNTS: Record<string, [number, number, number, number]> = {
  develop: [3, 12, 84, 40],
  main: [7, 21, 190, 88],
  'release/1.8': [11, 34, 402, 151],
};

const invalid = (message: string) =>
  new IpcError({ code: 'INVALID_INPUT', message, retryable: false });

/**
 * The target an S-11 command works against, with the core's guards: a repository first, then a
 * branch on origin (`branch_info::branch_range`). Its commits, files, + and −.
 */
export function mockTarget(
  repos: MockRepos,
  asked: string | undefined,
): { target: string; counts: [number, number, number, number] } {
  if (!repos.active()) throw invalid('Pick a repository first.');
  const target = asked === undefined ? TARGETS[0] : asked.replace(/^origin\//, '');
  const counts = target === undefined ? undefined : COUNTS[target];
  if (target === undefined || counts === undefined) {
    throw invalid('That target is not a branch on origin.');
  }
  return { target, counts };
}

/** The branch name in words, as `git::mr_title::words`. */
function words(branch: string): string {
  const joined = branch
    .split(/[/_-]/)
    .filter((w) => w !== '')
    .join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** The S-11 branch block (F-27.1) and the title from the commits (F-27.2) of the mock repository. */
export function createBranchInfoBackend(
  respond: <T>(value: T) => Promise<T>,
  repos: MockRepos,
): Pick<IpcClient, 'gitBranchInfo' | 'gitMrTitle'> {
  return {
    gitBranchInfo: async (asked) => {
      const { target, counts } = mockTarget(repos, asked);
      const [commits, files, additions, deletions] = counts;
      const info: BranchInfo = {
        branch: BRANCH,
        upstream: `origin/${BRANCH}`,
        targets: [...TARGETS],
        target,
        commits,
        files,
        additions,
        deletions,
      };
      return respond(info);
    },
    // Every mock target has several commits: the branch name in words.
    gitMrTitle: async (asked) => {
      mockTarget(repos, asked);
      return respond(words(BRANCH));
    },
  };
}
