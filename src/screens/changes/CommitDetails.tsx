import { Button } from '../../components/Button';
import type { CommitInfo } from '../../ipc/types/CommitInfo';
import { formatAge } from '../../format/age';
import styles from './Changes.module.css';

export interface CommitDetailsProps {
  info: CommitInfo;
}

/** Commit mode aside (F-15.6): SHA, subject, body, author · age, parent, Review step by step. */
export function CommitDetails({ info }: CommitDetailsProps) {
  const parent = info.parents[0];
  return (
    <aside className={styles.aside} aria-label="Commit details">
      <span className={styles.shaBlock}>{info.shortSha}</span>
      <h2 className={styles.subject}>{info.subject}</h2>
      {info.body && <p className={styles.body}>{info.body}</p>}
      <div className={styles.meta}>
        <span>
          {info.author} · {formatAge(info.date)}
        </span>
        {parent && (
          <span>
            Parent <span className={styles.parent}>{parent.slice(0, 7)}</span>
          </span>
        )}
      </div>
      {/* Step review of a commit comes with M3 (02 › S-06): a static placeholder until then. */}
      <Button variant="primary" size={42} className={styles.reviewStep}>
        Review step by step
      </Button>
    </aside>
  );
}
