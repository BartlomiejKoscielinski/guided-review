import { useNavigate } from 'react-router';
import type { NewMrState } from '../../app/router';
import { pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { useStatusSummary } from '../../ipc/hooks/useSources';
import type { StatusSummary } from '../../ipc/types/StatusSummary';
import styles from './Summary.module.css';

/**
 * A branch other than its target with commits ahead of it has something to describe in an MR.
 * On the local target branch itself unpushed commits still count as ahead of origin/<target>, but
 * an MR from the target into itself makes no sense.
 */
function hasMrToDescribe(summary: StatusSummary | undefined): boolean {
  if (!summary?.branch || !summary.target) return false;
  if (summary.branch === summary.targetName) return false;
  return (summary.branchVsTarget?.commits ?? 0) > 0;
}

/**
 * The end of a self-review (F-17.3): Draft MR description (S-11 for the current branch, the
 * description task asked for by that click, M7 decision 15) and Browse and commit (S-06 local).
 * Draft MR description is drawn only once the checkout is known to be on a branch ahead of its
 * target; while that is looked up or when the lookup fails, only Browse and commit is offered.
 */
export function SelfReviewNext() {
  const navigate = useNavigate();
  const summary = useStatusSummary(true);
  const state: NewMrState = { draftDescription: true };

  return (
    <div className={styles.next}>
      {hasMrToDescribe(summary.data) && (
        <Button
          variant="claude"
          size={38}
          onClick={() => {
            void navigate(pathFor({ screen: 'S-11' }), { state });
          }}
        >
          Draft MR description
        </Button>
      )}
      <Button
        variant="neutral"
        size={38}
        onClick={() => {
          void navigate(pathFor({ screen: 'S-06' }));
        }}
      >
        Browse and commit
      </Button>
    </div>
  );
}
