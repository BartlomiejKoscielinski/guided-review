import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { useUnfinishedSessions } from '../../ipc/hooks/useUnfinishedSessions';
import { ResumeCard } from './ResumeCard';
import { useNow } from './useNow';
import styles from './ResumeCards.module.css';

const HEADING_ID = 'start-resume';

/**
 * S-01 region 2, "Pick up where you left off" (F-04.1): the unfinished sessions in the order the
 * core returns them (newest first). Without one the section is not there at all.
 */
export function ResumeCards() {
  const navigate = useNavigate();
  const sessions = useUnfinishedSessions().data ?? [];
  // "saved 2 h ago" grows while S-01 stays open.
  const now = useNow(60_000);
  if (sessions.length === 0) return null;
  return (
    <section aria-labelledby={HEADING_ID} className={styles.section}>
      <h2 id={HEADING_ID} className={styles.heading}>
        Pick up where you left off
      </h2>
      <div className={styles.cards}>
        {sessions.map((session) => (
          <ResumeCard
            key={session.id}
            session={session}
            now={new Date(now)}
            onContinue={(s) => {
              void navigate(pathFor(s.resume));
            }}
          />
        ))}
      </div>
    </section>
  );
}
