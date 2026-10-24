import type { MergeCheck } from '../../ipc/types/MergeCheck';

/** One row of "Before you create": green (`ok`) or orange with its details. */
export interface CheckRow {
  id: 'branch' | 'conflicts' | 'review';
  label: string;
  note: string;
  ok: boolean;
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** How many conflicting files are named before the rest is counted. */
const NAMED_FILES = 3;

/** "2 files: MauiProgram.cs, App.xaml"; "5 files: a, b, c and 2 more". */
export function conflictNote(files: readonly string[]): string {
  const named = files.slice(0, NAMED_FILES).join(', ');
  const rest = files.length - NAMED_FILES;
  return `${plural(files.length, 'file', 'files')}: ${named}${rest > 0 ? ` and ${String(rest)} more` : ''}`;
}

function branchRow(check: MergeCheck): CheckRow {
  const remote = `origin/${check.branch}`;
  switch (check.pushed) {
    case 'pushed':
      return { id: 'branch', label: 'Branch pushed', note: `${remote} is up to date`, ok: true };
    case 'notPushed':
      return {
        id: 'branch',
        label: 'Branch not pushed',
        note: `${remote} does not exist yet.`,
        ok: false,
      };
    case 'ahead':
      return {
        id: 'branch',
        label: 'Branch not up to date',
        note: `${remote} is behind your latest commit.`,
        ok: false,
      };
  }
}

function conflictsRow(check: MergeCheck): CheckRow {
  return check.conflicts.length === 0
    ? {
        id: 'conflicts',
        label: `No conflicts with ${check.target}`,
        note: 'checked locally with git merge-tree',
        ok: true,
      }
    : {
        id: 'conflicts',
        label: `Conflicts with ${check.target}`,
        note: conflictNote(check.conflicts),
        ok: false,
      };
}

/** A self-review is done when every step is reviewed, open notes or not; no steps is none. */
function reviewRow(check: MergeCheck): CheckRow {
  const review = check.selfReview;
  if (review === undefined || review.total === 0) {
    return {
      id: 'review',
      label: 'Self-review not done',
      note: 'No self-review of this branch yet.',
      ok: false,
    };
  }
  const done = review.reviewed >= review.total;
  return {
    id: 'review',
    label: done ? 'Self-review done' : 'Self-review not done',
    note: `${String(review.reviewed)} of ${plural(review.total, 'step', 'steps')} · ${plural(review.notes, 'open note', 'open notes')}`,
    ok: done,
  };
}

/** The three checks in the order of CreateMR.dc.html. */
export function checkRows(check: MergeCheck): CheckRow[] {
  return [branchRow(check), conflictsRow(check), reviewRow(check)];
}

/**
 * M7 decision 19: only a branch that is not on origin and an open MR of the branch block Create;
 * conflicts, a branch behind HEAD and a missing self-review are warnings.
 */
export function blocksCreate(check: MergeCheck): boolean {
  return check.pushed === 'notPushed' || check.existingMr !== undefined;
}
