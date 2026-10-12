import type { Preparation } from '../../state/start';

export type StageState = 'done' | 'current' | 'pending' | 'failed';

export interface StageLine {
  label: string;
  state: StageState;
}

const ORDER = ['fetching', 'creatingWorktree', 'computingDiff'] as const;

/**
 * The S-02 Preparing lines (F-05.6): "Fetching !482", "Creating worktree", "Computing diff ·
 * 16 files". Stages before the current one are done; a failure marks the current one.
 */
export function stageLines(preparation: Preparation): StageLine[] {
  const { progress, outcome } = preparation;
  const current = progress ? ORDER.indexOf(progress.stage) : 0;
  const files = progress?.stage === 'computingDiff' ? progress.files : undefined;
  const diff =
    files === undefined
      ? 'Computing diff'
      : `Computing diff · ${String(files)} ${files === 1 ? 'file' : 'files'}`;
  const labels = [`Fetching !${String(preparation.iid)}`, 'Creating worktree', diff];
  return labels.map((label, i): StageLine => {
    if (outcome?.kind === 'opened' || i < current) return { label, state: 'done' };
    if (i > current) return { label, state: 'pending' };
    return { label, state: outcome?.kind === 'failed' ? 'failed' : 'current' };
  });
}
