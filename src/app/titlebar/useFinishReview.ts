import { useMatches, useNavigate } from 'react-router';
import { pathFor } from '../routes';

/**
 * Finish review (F-30.3) opens the session's summary, S-05: the self-review summary for commits and
 * local changes (F-17.4, M3 decision 9), the stub for an MR session until its milestone.
 */
export function useFinishReview(): () => void {
  const sessionId = useMatches().at(-1)?.params.sessionId ?? '';
  const navigate = useNavigate();
  return () => {
    if (sessionId !== '') void navigate(pathFor({ screen: 'S-05', sessionId }));
  };
}
