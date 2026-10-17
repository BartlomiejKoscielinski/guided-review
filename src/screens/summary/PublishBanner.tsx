import { Button } from '../../components/Button';
import { CheckIcon } from '../../components/icons';
import type { PublishOutcome } from '../../ipc/types/PublishOutcome';
import { publishedText } from './publishCopy';
import styles from './Publish.module.css';

export interface PublishBannerProps {
  outcome: PublishOutcome;
  /** A failed row is still ticked. */
  canRetry: boolean;
  onRetry: () => void;
}

/**
 * What the last Publish did (F-12.5): the blue block "Published N comments[ and a summary]. The
 * author got a single notification." (SummaryDesk.dc.html), or with a failure the orange block
 * "Published 3 of 5. 2 failed: <reason>." with Retry (M5 decision 9). Both are status regions.
 */
export function PublishBanner({ outcome, canRetry, onRetry }: PublishBannerProps) {
  const text = publishedText(outcome);
  if (outcome.failed.length === 0) {
    return (
      <div role="status" className={styles.sent}>
        <CheckIcon size={16} strokeWidth={2.8} />
        <span>{text}</span>
      </div>
    );
  }
  return (
    <div role="status" className={styles.failed}>
      <span className={styles.failedText}>{text}</span>
      <Button size={30} disabled={!canRetry} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
