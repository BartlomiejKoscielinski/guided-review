import { useDrafts } from '../../ipc/hooks/useDrafts';
import { checklistText } from './checklist';
import { CopyChecklist } from './CopyChecklist';
import { KeptNote } from './KeptNote';
import { SelfReviewNext } from './SelfReviewNext';
import { SummaryHeader } from './SummaryHeader';
import styles from './Summary.module.css';

export interface SelfReviewSummaryProps {
  sessionId: string;
}

/**
 * S-05 of a self-review (F-17.4): the drafts list of an MR summary without Publish, Threads or the
 * Approval tile, because nothing reaches GitLab. It lists the notes kept to fix, in the order they
 * were made, and copies them as a checklist. Under the list come the next steps (F-17.3).
 */
export function SelfReviewSummary({ sessionId }: SelfReviewSummaryProps) {
  const drafts = useDrafts(sessionId);
  const kept = drafts.data;

  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        <SummaryHeader sessionId={sessionId} />

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

        <SelfReviewNext />
      </div>
    </div>
  );
}
