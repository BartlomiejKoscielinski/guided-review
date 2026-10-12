import { CheckIcon } from '../../components/icons';
import type { CommitResult } from '../../ipc/types/CommitResult';
import styles from './Changes.module.css';

export interface CreatedBlockProps {
  created: CommitResult;
  pushing: boolean;
  /** "Pushed to origin/<branch>." after Push only. */
  pushed: string | null;
  onPushAndCreateMr: () => void;
  onPushOnly: () => void;
  onNewCommit: () => void;
}

/** Green block after a commit (F-16.5): Created <sha>, Push and create MR, Push only, New commit. */
export function CreatedBlock({
  created,
  pushing,
  pushed,
  onPushAndCreateMr,
  onPushOnly,
  onNewCommit,
}: CreatedBlockProps) {
  return (
    <div role="status" className={styles.created}>
      <span className={styles.createdTitle}>
        <CheckIcon size={16} strokeWidth={2.8} />
        Created <span className={styles.createdSha}>{created.shortSha}</span>
      </span>
      {pushed && <span className={styles.pushed}>{pushed}</span>}
      <div className={styles.createdActions}>
        {!pushed && (
          <>
            <button
              type="button"
              className={styles.inkButton}
              disabled={pushing}
              onClick={onPushAndCreateMr}
            >
              Push and create MR
            </button>
            <button
              type="button"
              className={styles.ringButton}
              disabled={pushing}
              onClick={onPushOnly}
            >
              Push only
            </button>
          </>
        )}
        <button type="button" className={styles.textButton} onClick={onNewCommit}>
          New commit
        </button>
      </div>
    </div>
  );
}
