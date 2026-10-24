import type { IpcClient } from '../client';
import type { ExistingMr } from '../types/ExistingMr';
import type { MergeCheck } from '../types/MergeCheck';
import type { PushState } from '../types/PushState';
import type { SelfReviewProgress } from '../types/SelfReviewProgress';
import { mockTarget } from './branchInfo';
import { BRANCH } from './fixtures/changes';
import type { MockRepos } from './repos';

/** Key with a `MergeCheckScenario` for S-11's "Before you create" (e2e and dev:mock). */
export const MOCK_MR_CHECKS_KEY = 'guided-review.mock.mrChecks';

/** Variations of "Before you create"; missing fields keep CreateMR.dc.html. */
export interface MergeCheckScenario {
  pushed?: PushState;
  /** `null`: the repository has no self-review. */
  selfReview?: SelfReviewProgress | null;
  existingMr?: ExistingMr;
}

/** Conflicts per target, in the order CreateMR.dc.html lists them; other targets merge cleanly. */
const CONFLICTS: Record<string, string[]> = { main: ['MauiProgram.cs', 'App.xaml'] };

const MOCK_SELF_REVIEW: SelfReviewProgress = { reviewed: 6, total: 6, notes: 0 };

/**
 * `git_merge_check` of the mock repository (F-27.5) with the core's guards (`mockTarget`), and
 * `gitPush` wrapped so a push turns the branch to pushed.
 */
export function createMergeCheckBackend(
  respond: <T>(value: T) => Promise<T>,
  repos: MockRepos,
  scenario: MergeCheckScenario,
  push: IpcClient['gitPush'],
): Pick<IpcClient, 'gitMergeCheck' | 'gitPush'> {
  let pushed: PushState = scenario.pushed ?? 'pushed';
  const selfReview = scenario.selfReview === undefined ? MOCK_SELF_REVIEW : scenario.selfReview;
  return {
    gitMergeCheck: async (asked) => {
      const { target } = mockTarget(repos, asked);
      const check: MergeCheck = {
        branch: BRANCH,
        target,
        pushed,
        conflicts: [...(CONFLICTS[target] ?? [])],
        ...(selfReview === null ? {} : { selfReview: { ...selfReview } }),
        ...(scenario.existingMr === undefined ? {} : { existingMr: { ...scenario.existingMr } }),
      };
      return respond(check);
    },
    gitPush: async () => {
      const result = await push();
      pushed = 'pushed';
      return result;
    },
  };
}
