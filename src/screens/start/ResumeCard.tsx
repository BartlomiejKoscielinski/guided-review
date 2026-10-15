import { cx } from '../../components/cx';
import { Button } from '../../components/Button';
import type { UnfinishedSession } from '../../ipc/types/UnfinishedSession';
import { progressLine, sourceTag } from './resumeProgress';
import styles from './ResumeCards.module.css';

export interface ResumeCardProps {
  session: UnfinishedSession;
  now: Date;
  onContinue: (session: UnfinishedSession) => void;
}

/**
 * One "Pick up where you left off" card (Start.dc.html): tag and title, the progress line and
 * **Continue**. The "N new commits" tag and **Only new changes** come with F-04.2 (M3 decision 10).
 */
export function ResumeCard({ session, now, onContinue }: ResumeCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.text}>
        <span className={styles.head}>
          <span className={cx(styles.tag, styles[session.source.kind])}>
            {sourceTag(session.source)}
          </span>
          <span className={styles.title}>{session.title}</span>
        </span>
        <span className={styles.progress}>{progressLine(session, now)}</span>
      </div>
      <Button
        variant="neutral"
        size={36}
        onClick={() => {
          onContinue(session);
        }}
      >
        Continue
      </Button>
    </div>
  );
}
