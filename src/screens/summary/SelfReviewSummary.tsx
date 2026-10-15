import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { ChevronLeftIcon } from '../../components/icons';
import { useDrafts } from '../../ipc/hooks/useDrafts';
import { useStepProgress } from '../step/useStepProgress';
import { checklistText, progressLine } from './checklist';
import { CopyChecklist } from './CopyChecklist';
import { KeptNote } from './KeptNote';
import styles from './Summary.module.css';

export interface SelfReviewSummaryProps {
  sessionId: string;
}

/**
 * S-05 of a self-review (F-17.4): the drafts list of an MR summary without Publish, Threads or the
 * Approval tile, because nothing reaches GitLab. It lists the notes kept to fix, in the order they
 * were made, and copies them as a checklist.
 */
export function SelfReviewSummary({ sessionId }: SelfReviewSummaryProps) {
  const navigate = useNavigate();
  const drafts = useDrafts(sessionId);
  // The plan the steps screen cached; this never starts a plan (F-30.4).
  const { order, reviewed } = useStepProgress(sessionId);
  const done = order.filter((id) => reviewed.includes(id)).length;
  const kept = drafts.data;

  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        <section className={styles.header}>
          <div className={styles.heading}>
            <h1 className={styles.title}>Summary</h1>
            {order.length > 0 && (
              <p className={styles.progress}>{progressLine(done, order.length)}</p>
            )}
          </div>
          <Button
            size={38}
            className={styles.back}
            onClick={() => {
              void navigate(pathFor({ screen: 'S-03', sessionId }));
            }}
          >
            <ChevronLeftIcon size={14} strokeWidth={2.4} />
            Back to steps
          </Button>
        </section>

        <section className={styles.list} aria-labelledby="to-fix">
          <div className={styles.listHead}>
            <h2 id="to-fix" className={styles.listTitle}>
              To fix
              {kept && <span className={styles.count}>{String(kept.length)}</span>}
            </h2>
            <CopyChecklist text={kept ? checklistText(kept) : ''} />
          </div>
          {drafts.isError && (
            <div role="alert" className={styles.empty}>
              {drafts.error.message}
            </div>
          )}
          {kept?.length === 0 && <div className={styles.empty}>Nothing to fix.</div>}
          {kept && kept.length > 0 && (
            <ul className={styles.notes}>
              {kept.map((draft) => (
                <KeptNote key={draft.id} draft={draft} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
