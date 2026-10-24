import { useState } from 'react';
import { useLocation } from 'react-router';
import type { NewMrState } from '../../app/router';
import { Button } from '../../components/Button';
import { useBranchInfo } from '../../ipc/hooks/useBranchInfo';
import { BranchRow } from './BranchRow';
import { MrOptions } from './MrOptions';
import { DEFAULT_MR_OPTIONS, type MrOptionValues } from './mrOptionValues';
import { MrTextFields } from './MrTextFields';
import { type AddedReviewer, Reviewers } from './Reviewers';
import reviewerStyles from './Reviewers.module.css';
import { useMrText } from './useMrText';
import styles from './CreateMr.module.css';

/** History entries whose Draft MR description run has started. */
const draftedEntries = new Set<string>();

/**
 * S-11 New merge request (F-27): opened from Push and create MR (S-06), the self-review's Draft
 * MR description (F-17.3) and, from M10, Rider. F-27.1: the heading and the branch block;
 * F-27.2: Title and Description; F-27.3: the Reviewers in the aside; F-27.4: the options and the
 * Create button's label (its action is F-27.6).
 */
export function CreateMrScreen() {
  const location = useLocation();
  // Draft MR description asked for one run (M7 decision 15): once per history entry, so going
  // back and forward to it again starts nothing.
  const [draftEntry] = useState(() =>
    (location.state as NewMrState | null)?.draftDescription === true &&
    !draftedEntries.has(location.key)
      ? location.key
      : null,
  );
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [reviewers, setReviewers] = useState<AddedReviewer[]>([]);
  const [options, setOptions] = useState<MrOptionValues>(DEFAULT_MR_OPTIONS);
  // The default target gives the branch and the select's options; a chosen one only the numbers.
  const base = useBranchInfo(undefined);
  const picked = useBranchInfo(chosen, chosen !== undefined);
  const counted = chosen === undefined ? base : picked;
  const info = base.data;
  const text = useMrText(chosen, chosen ?? info?.target, draftEntry !== null, () => {
    if (draftEntry === null || draftedEntries.has(draftEntry)) return false;
    draftedEntries.add(draftEntry);
    return true;
  });

  const target = chosen ?? info?.target ?? info?.targets[0];
  const ready = info?.branch !== undefined && target !== undefined;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
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
          {info?.branch !== undefined && info.targets.length > 0 && (
            <>
              <MrTextFields text={text} commits={counted.data?.commits} />
              <MrOptions values={options} onChange={setOptions} />
            </>
          )}
        </div>
      </div>
      {ready && (
        <aside aria-label="Reviewers and checks" className={reviewerStyles.aside}>
          <Reviewers target={target} added={reviewers} onAdded={setReviewers} />
          <div className={reviewerStyles.createBlock}>
            <Button variant="primary" size={50}>
              {options.draft ? 'Create draft MR' : 'Create merge request'}
            </Button>
          </div>
        </aside>
      )}
    </div>
  );
}
