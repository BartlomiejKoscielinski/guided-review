import { useState } from 'react';
import { useBranchInfo } from '../../ipc/hooks/useBranchInfo';
import { BranchRow } from './BranchRow';
import styles from './CreateMr.module.css';

/**
 * S-11 New merge request (F-27): opened from Push and create MR (S-06), the self-review's Draft
 * MR description (F-17.3) and, from M10, Rider. F-27.1: the heading and the branch block.
 */
export function CreateMrScreen() {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  // The default target gives the branch and the select's options; a chosen one only the numbers.
  const base = useBranchInfo(undefined);
  const picked = useBranchInfo(chosen, chosen !== undefined);
  const counted = chosen === undefined ? base : picked;
  const info = base.data;

  return (
    <div className={styles.screen}>
      <section className={styles.head}>
        <h1 className={styles.heading}>New merge request</h1>
        {info === undefined ? (
          base.isError ? (
            <p className={styles.alert} role="alert">
              {base.error.message}
            </p>
          ) : (
            <div className={styles.loading} aria-busy="true" aria-label="Loading branch" />
          )
        ) : info.branch === undefined ? (
          <p className={styles.alert} role="alert">
            Check out a branch to create a merge request.
          </p>
        ) : info.targets.length === 0 ? (
          <div className={styles.branchRow} data-testid="mr-branch">
            <span className={styles.source}>{info.branch}</span>
            <span className={styles.note}>No branch on origin to merge into.</span>
          </div>
        ) : (
          <BranchRow
            branch={info.branch}
            targets={info.targets}
            target={chosen ?? info.target ?? info.targets[0] ?? ''}
            counts={counted.data}
            error={counted.isError ? counted.error.message : undefined}
            onTarget={setChosen}
          />
        )}
      </section>
    </div>
  );
}
