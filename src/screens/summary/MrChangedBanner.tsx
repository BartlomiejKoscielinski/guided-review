import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { useSummaryStatus } from '../../ipc/hooks/useSummaryStatus';
import styles from './Publish.module.css';

export interface MrChangedBannerProps {
  sessionId: string;
  /** Restored on start (F-30.4): GitLab is not asked, so nothing is compared. */
  restored: boolean;
}

/**
 * S-05's MR-changed state (F-14.2, M5 decision 10a): the yellow banner "The MR has a new version
 * since your review." with **See what changed** to S-09, while the MR's head differs from the
 * reviewed head (or GitLab refused the approval as stale). Approve MR is disabled meanwhile.
 */
export function MrChangedBanner({ sessionId, restored }: MrChangedBannerProps) {
  const navigate = useNavigate();
  const status = useSummaryStatus(sessionId, !restored);
  if (restored || status.data?.changed !== true) return null;
  return (
    <div role="status" className={styles.foreign}>
      <span className={styles.failedText}>The MR has a new version since your review.</span>
      <Button size={30} onClick={() => void navigate(pathFor({ screen: 'S-09', sessionId }))}>
        See what changed
      </Button>
    </div>
  );
}
