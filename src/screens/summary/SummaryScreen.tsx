import { useParams } from 'react-router';
import { useSelfReviewKnown } from '../step/useSelfReview';
import { MrSummary } from './MrSummary';
import { SelfReviewSummary } from './SelfReviewSummary';
import styles from './Summary.module.css';

/**
 * S-05 Summary. A self-review (commits or local changes) has its summary of kept notes (F-17.4);
 * an MR session has the MR summary (F-12.1). While the session is looked up neither is drawn, so a
 * self-review never shows the MR copy first; a failed lookup keeps the MR copy, as S-03 does.
 */
export function SummaryScreen() {
  const { sessionId = '' } = useParams();
  const selfReview = useSelfReviewKnown(sessionId);
  if (selfReview === undefined) return <div className={styles.screen} aria-busy="true" />;
  return selfReview ? (
    <SelfReviewSummary key={sessionId} sessionId={sessionId} />
  ) : (
    <MrSummary key={sessionId} sessionId={sessionId} />
  );
}
