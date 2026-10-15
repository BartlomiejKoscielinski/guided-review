import { useParams } from 'react-router';
import { StubScreen } from '../StubScreen';
import { useSelfReview } from '../step/useSelfReview';
import { SelfReviewSummary } from './SelfReviewSummary';

/**
 * S-05 Summary. A self-review (commits or local changes) has its summary of kept notes (F-17.4);
 * an MR session keeps the stub until its milestone (docs/07), its drafts stay local.
 */
export function SummaryScreen() {
  const { sessionId = '' } = useParams();
  const selfReview = useSelfReview(sessionId);
  return selfReview ? (
    <SelfReviewSummary key={sessionId} sessionId={sessionId} />
  ) : (
    <StubScreen name="Summary" />
  );
}
