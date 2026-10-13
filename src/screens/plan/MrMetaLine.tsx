import { Link } from 'react-router';
import { pathFor } from '../../app/routes';
import { cx } from '../../components/cx';
import { formatAge } from '../../format/age';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { pipelineText } from '../start/mrRow';
import styles from './Plan.module.css';

export interface MrMetaLineProps {
  session: SessionMr;
}

/**
 * The S-02 meta line (F-06.1): author · age, `source → target`, `N files +add −del · N commits`,
 * pipeline status linking to S-08. The pipeline is the one GitLab reported at preparation.
 */
export function MrMetaLine({ session }: MrMetaLineProps) {
  const { mr } = session;
  const age = mr.createdAt ? formatAge(mr.createdAt) : '';
  const byline = [mr.author, age].filter((part) => part !== '').join(' · ');
  const files = `${String(session.totalFiles)} ${session.totalFiles === 1 ? 'file' : 'files'}`;
  const commits = `${String(session.commits)} ${session.commits === 1 ? 'commit' : 'commits'}`;
  return (
    <>
      {byline && <span>{byline}</span>}
      <span className={styles.branch}>
        {mr.sourceBranch} → {mr.targetBranch}
      </span>
      <span className={styles.counts}>
        {files} <span className={styles.add}>+{session.additions}</span>{' '}
        <span className={styles.del}>−{session.deletions}</span> · {commits}
      </span>
      {mr.pipeline && (
        <Link className={styles.pipeline} to={pathFor({ screen: 'S-08', iid: mr.iid })}>
          <span
            className={cx(styles.pipeSquare, styles[`pipe-${mr.pipeline}`])}
            aria-hidden="true"
          />
          {pipelineText(mr.pipeline)}
        </Link>
      )}
    </>
  );
}
