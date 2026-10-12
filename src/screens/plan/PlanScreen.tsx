import { useParams } from 'react-router';
import { PlanPrepared } from './PlanPrepared';
import { Preparing } from './Preparing';

/** S-02 Review plan: Preparing until the MR has a session (F-05.6), then the plan (F-06). */
export function PlanScreen() {
  const { sessionId } = useParams();
  return sessionId ? <PlanPrepared key={sessionId} sessionId={sessionId} /> : <Preparing />;
}
