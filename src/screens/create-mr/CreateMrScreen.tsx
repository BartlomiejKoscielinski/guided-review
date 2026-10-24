import { useState } from 'react';
import { useLocation } from 'react-router';
import type { NewMrState } from '../../app/router';
import { useBranchInfo } from '../../ipc/hooks/useBranchInfo';
import { useCreateMr } from '../../ipc/hooks/useCreateMr';
import { useMergeCheck } from '../../ipc/hooks/useMergeCheck';
import { useReviewerSuggestions } from '../../ipc/hooks/useReviewers';
import type { CreatedMr } from '../../ipc/types/CreatedMr';
import { BeforeYouCreate } from './BeforeYouCreate';
import { BranchRow } from './BranchRow';
import { CreateBlock } from './CreateBlock';
import { ExistingMrBanner } from './ExistingMrBanner';
import { blocksCreate } from './mergeChecks';
import { MrCreated } from './MrCreated';
import { MrOptions } from './MrOptions';
import { DEFAULT_MR_OPTIONS, type MrOptionValues } from './mrOptionValues';
import { MrTextFields } from './MrTextFields';
import { type AddedReviewer, Reviewers } from './Reviewers';
import reviewerStyles from './Reviewers.module.css';
import { addedInListOrder, notifyNote } from './reviewerOrder';
import { useMrText } from './useMrText';
import styles from './CreateMr.module.css';

/** History entries whose Draft MR description run has started. */
const draftedEntries = new Set<string>();

/**
 * S-11 New merge request (F-27): opened from Push and create MR (S-06), the self-review's Draft
 * MR description (F-17.3) and, from M10, Rider. F-27.1: the heading and the branch block;
 * F-27.2: Title and Description; F-27.3: the Reviewers in the aside; F-27.4: the options and the
 * Create button's label; F-27.5: Before you create and the open-MR banner; F-27.6: Create on the
 * click, the note on who gets notified and the success view, which replaces the whole screen.
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
  const checks = useMergeCheck(chosen, ready);
  const check = checks.data;
  // M7 decision 19: not pushed or an open MR block Create; while the checks load it waits, and a
  // failed check (unknown) does not block.
  const blocked = check === undefined ? checks.isPending : blocksCreate(check);
  const suggestions = useReviewerSuggestions(target, ready);
  const people = addedInListOrder(suggestions.data ?? [], reviewers);
  const names = people.map((p) => p.name);
  const create = useCreateMr();
  const [created, setCreated] = useState<{ mr: CreatedMr; reviewers: string[] } | null>(null);
  const onCreate = () => {
    if (target === undefined || create.isPending) return;
    create.mutate(
      {
        target,
        title: text.title,
        description: text.description,
        reviewerIds: people.map((p) => p.id),
        draft: options.draft,
        removeSourceBranch: options.deleteBranch,
        squash: options.squash,
      },
      {
        onSuccess: (mr) => {
          setCreated({ mr, reviewers: names });
        },
      },
    );
  };

  if (created !== null) {
    return (
      <div className={styles.layout}>
        <div className={styles.main}>
          <MrCreated mr={created.mr} reviewers={created.reviewers} />
        </div>
      </div>
    );
  }

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
            {ready && check?.existingMr !== undefined && <ExistingMrBanner mr={check.existingMr} />}
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
          <BeforeYouCreate
            check={check}
            loading={check === undefined && checks.isPending}
            error={checks.error}
          />
          <CreateBlock
            draft={options.draft}
            blocked={blocked}
            creating={create.isPending}
            error={create.error?.message ?? null}
            note={notifyNote(names)}
            onCreate={onCreate}
          />
        </aside>
      )}
    </div>
  );
}
