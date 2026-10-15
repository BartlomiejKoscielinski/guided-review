import { formatAge } from '../../format/age';
import type { CommitInfo } from '../../ipc/types/CommitInfo';
import type { PlanView } from '../../ipc/types/PlanView';
import type { Source } from '../../ipc/types/Source';
import { plural } from './planText';
import { changeTotals } from './sourceText';
import styles from './Plan.module.css';

export interface SourceMetaLineProps {
  source: Source;
  /** The reviewed commit of a single-commit session, once loaded. */
  commit: CommitInfo | undefined;
  /** The plan, once there: the change's files and lines. */
  view: PlanView | undefined;
}

/**
 * The S-02 meta line of a session without an MR (F-17.1), like the MR's (F-06.1): a commit's
 * author · age and short SHA, then `N files +add −del` when the plan is there.
 */
export function SourceMetaLine({ source, commit, view }: SourceMetaLineProps) {
  const byline = commit
    ? [commit.author, commit.date ? formatAge(commit.date) : ''].filter((p) => p !== '').join(' · ')
    : '';
  const totals = view ? changeTotals(view) : null;
  return (
    <>
      {byline && <span>{byline}</span>}
      {source.kind === 'commits' && source.from === undefined && (
        <span className={styles.branch}>{source.to.slice(0, 7)}</span>
      )}
      {totals && (
        <span className={styles.counts}>
          {plural(totals.files, 'file')} <span className={styles.add}>+{totals.additions}</span>{' '}
          <span className={styles.del}>−{totals.deletions}</span>
        </span>
      )}
    </>
  );
}
