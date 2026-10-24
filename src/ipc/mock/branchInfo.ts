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

/** The S-11 branch block of the mock repository (F-27.1). */
export function createBranchInfoBackend(
  respond: <T>(value: T) => Promise<T>,
  repos: MockRepos,
): Pick<IpcClient, 'gitBranchInfo'> {
  return {
    gitBranchInfo: async (asked) => {
      if (!repos.active()) {
        throw new IpcError({
          code: 'INVALID_INPUT',
          message: 'Pick a repository first.',
          retryable: false,
        });
      }
      const target = asked === undefined ? TARGETS[0] : asked.replace(/^origin\//, '');
      const counts = target === undefined ? undefined : COUNTS[target];
      if (target === undefined || counts === undefined) {
        throw new IpcError({
          code: 'INVALID_INPUT',
          message: 'That target is not a branch on origin.',
          retryable: false,
        });
      }
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
  };
}
