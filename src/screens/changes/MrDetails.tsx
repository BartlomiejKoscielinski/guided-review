import { formatAge } from '../../format/age';
import type { SessionMr } from '../../ipc/types/SessionMr';
import styles from './Changes.module.css';

export interface MrDetailsProps {
  session: SessionMr;
}

/** MR browse aside (02 › S-06 MR browse): `!iid`, title, author · age, branches, size. No actions. */
export function MrDetails({ session }: MrDetailsProps) {
  const { mr } = session;
  const byline = [mr.author, mr.createdAt ? formatAge(mr.createdAt) : '']
    .filter((part) => part !== '')
    .join(' · ');
  const files = `${String(session.totalFiles)} ${session.totalFiles === 1 ? 'file' : 'files'}`;
  const commits = `${String(session.commits)} ${session.commits === 1 ? 'commit' : 'commits'}`;
  return (
    <aside className={styles.aside} aria-label="Merge request details">
      <span className={styles.shaBlock}>!{mr.iid}</span>
      <h2 className={styles.subject}>{mr.title}</h2>
      <span className={styles.mrBranch}>
        {mr.sourceBranch} → {mr.targetBranch}
      </span>
      <div className={styles.meta}>
        {byline && <span>{byline}</span>}
        <span className={styles.parent}>
          {files} +{session.additions} −{session.deletions} · {commits}
        </span>
      </div>
    </aside>
  );
}
