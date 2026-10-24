import type { BranchInfo } from '../../ipc/types/BranchInfo';
import styles from './CreateMr.module.css';

export interface BranchRowProps {
  /** The source branch. */
  branch: string;
  /** Branches on `origin`, the default first. */
  targets: string[];
  /** The select's value: the user's choice, else the default target. */
  target: string;
  /** The numbers for `target`; undefined while they are counted (the old ones are not shown). */
  counts: BranchInfo | undefined;
  /** Why the numbers for `target` could not be counted. */
  error?: string;
  onTarget: (target: string) => void;
}

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** `source → target` with the target select and `N commits · N files · +/−` (F-27.1). */
export function BranchRow({ branch, targets, target, counts, error, onTarget }: BranchRowProps) {
  return (
    <div className={styles.branchRow} data-testid="mr-branch">
      <span className={styles.source}>{branch}</span>
      <svg
        className={styles.arrow}
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        aria-hidden="true"
      >
        <path d="M2 8h11M9.5 4.5 13 8l-3.5 3.5" />
      </svg>
      <label htmlFor="mr-target" className="visually-hidden">
        Target branch
      </label>
      <select
        id="mr-target"
        className={styles.target}
        value={target}
        onChange={(event) => {
          onTarget(event.target.value);
        }}
      >
        {targets.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {error !== undefined ? (
        <span className={styles.statsError} data-testid="mr-branch-stats" role="alert">
          {error}
        </span>
      ) : (
        <span
          className={styles.stats}
          data-testid="mr-branch-stats"
          aria-busy={counts === undefined}
        >
          {counts === undefined ? null : (
            <>
              {plural(counts.commits, 'commit')} · {plural(counts.files, 'file')} ·{' '}
              <span className={styles.added}>+{counts.additions}</span>{' '}
              <span className={styles.deleted}>−{counts.deletions}</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
