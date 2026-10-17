import { SummaryHeader } from './SummaryHeader';
import styles from './Summary.module.css';

export interface MrSummaryProps {
  sessionId: string;
}

/**
 * S-05 of an MR session (F-12.1, SummaryDesk.dc.html): "SUMMARY", how many steps are reviewed and
 * Back to steps. The drafts and threads tabs with Publish (F-12, F-13) and the Approval tile (F-14)
 * fill the page below the head as their criteria land.
 */
export function MrSummary({ sessionId }: MrSummaryProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        <SummaryHeader sessionId={sessionId} />
      </div>
    </div>
  );
}
