import { useIsFetching } from '@tanstack/react-query';
import { useMatches } from 'react-router';
import { Square } from '../../components/Square';
import { formatAge } from '../../format/age';
import { usePlan } from '../../ipc/hooks/usePlan';
import { findingsKey } from '../../ipc/hooks/useReview';
import styles from './TitleBar.module.css';

function Status({ sessionId }: { sessionId: string }) {
  const { query } = usePlan(sessionId);
  const view = query.data;
  const firstStep = view && !view.fallback ? (view.order.order[0] ?? '') : '';
  const analyzing = useIsFetching({ queryKey: findingsKey(sessionId, firstStep) }) > 0;
  let text: string;
  if (!view) {
    if (!query.isFetching) return null;
    text = 'Claude is planning';
  } else if (view.fallback) {
    text = "Claude isn't available";
  } else if (view.cachedAt) {
    text = `Plan from cache · ${formatAge(view.cachedAt)}`;
  } else {
    text = analyzing ? 'Plan ready · Claude is analyzing step 1' : 'Plan ready';
  }
  return (
    <span className={styles.status} role="status">
      <Square color={view?.fallback ? 'orange' : 'purple'} />
      {text}
    </span>
  );
}

/**
 * S-02 title-bar status (F-06.12, 02 › S-02 states): Claude planning, plan ready with the first
 * step's analysis, the cached plan's age, or Claude unavailable.
 */
export function PlanStatus() {
  const matches = useMatches();
  const sessionId = matches.at(-1)?.params.sessionId;
  return sessionId ? <Status sessionId={sessionId} /> : null;
}
