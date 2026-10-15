import type { PlanView } from '../../ipc/types/PlanView';
import type { Source } from '../../ipc/types/Source';

const short = (sha: string) => sha.slice(0, 7);

/** `origin/develop` → `develop`, as S-01's "Whole branch vs develop" card names the target. */
const targetName = (target: string) =>
  target.replace(/^refs\/remotes\//, '').replace(/^origin\//, '');

/**
 * S-02's heading of a session without an MR (F-17.1): a commit's subject (its short SHA until
 * the subject is known), a range of commits, or the My changes scope as S-01 names it.
 */
export function sourceTitle(source: Source, subject: string | undefined): string {
  switch (source.kind) {
    case 'mr':
      return `Merge request !${String(source.iid)}`;
    case 'commits':
      if (source.from !== undefined) return `Commits ${short(source.from)}..${short(source.to)}`;
      return subject ?? `Commit ${short(source.to)}`;
    case 'local':
      switch (source.scope.kind) {
        case 'uncommitted':
          return 'Uncommitted changes';
        case 'staged':
          return 'Staged only';
        case 'branchVsTarget':
          return `Whole branch vs ${targetName(source.scope.target)}`;
      }
  }
}

/**
 * The aside card comparing the description with the code (F-06.8): a commits session's
 * description is its commit messages (M3 decision 13); local changes have none.
 */
export function claimsHeading(source: Source | null): string {
  if (source === null || source.kind === 'mr') return 'MR description vs code';
  return source.kind === 'commits' ? 'Commit messages vs code' : 'Description vs code';
}

/**
 * The change's size from the plan: every hunk is in exactly one step or skim group (coverage
 * invariant), so the rows' lines add up to the change; files come from Coverage.
 */
export function changeTotals(view: PlanView): {
  files: number;
  additions: number;
  deletions: number;
} {
  const rows = [...view.stepStats, ...view.skimStats];
  return {
    files: view.plan.coverage.filesTotal,
    additions: rows.reduce((sum, row) => sum + row.additions, 0),
    deletions: rows.reduce((sum, row) => sum + row.deletions, 0),
  };
}
