import type { RepoOperation } from '../../ipc/types/RepoOperation';

/** Why Commit is disabled while git is in the middle of something (02 › S-06 States). */
export function operationReason(operation: RepoOperation | undefined): string | null {
  switch (operation) {
    case 'merge':
      return 'A merge is in progress. Finish or abort it in Rider or git first.';
    case 'rebase':
      return 'A rebase is in progress. Finish or abort it in Rider or git first.';
    case 'cherryPick':
      return 'A cherry-pick is in progress. Finish or abort it in Rider or git first.';
    case 'revert':
      return 'A revert is in progress. Finish or abort it in Rider or git first.';
    case undefined:
      return null;
  }
}

/** "3 files", "1 file". */
export function files(n: number): string {
  return `${String(n)} ${n === 1 ? 'file' : 'files'}`;
}
