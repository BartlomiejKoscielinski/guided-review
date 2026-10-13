import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { usePlan, useReorderSteps, useSetStrategy } from '../../ipc/hooks/usePlan';
import { useStepFindings } from '../../ipc/hooks/useReview';
import { useSessionMr } from '../../ipc/hooks/useSources';
import { StubScreen } from '../StubScreen';
import { FallbackBanner } from './FallbackBanner';
import { MrMetaLine } from './MrMetaLine';
import { PlanAside } from './PlanAside';
import { PlanHeader } from './PlanHeader';
import { PlanIntent } from './PlanIntent';
import { PlanList } from './PlanList';
import styles from './Plan.module.css';

export interface PlanPreparedProps {
  sessionId: string;
}

/** Enter outside controls and fields starts step 1 (F-06.11). */
function isTypingOrControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, textarea, select') !== null;
}

/**
 * S-02 Review plan of a prepared MR session (F-06): the header right away, then Claude's plan
 * (or the app's file-order fallback when Claude failed) with the aside. When the plan is there,
 * the first step's analysis starts, so the title bar can say so (F-06.12).
 */
export function PlanPrepared({ sessionId }: PlanPreparedProps) {
  const navigate = useNavigate();
  const session = useSessionMr(sessionId);
  const { query: plan } = usePlan(sessionId);
  const setStrategy = useSetStrategy(sessionId);
  const reorder = useReorderSteps(sessionId);
  const view = plan.data;
  const fallback = view?.fallback;
  const firstStep = view && !fallback ? (view.order.order[0] ?? '') : '';
  useStepFindings(sessionId, firstStep);
  const canStart = Boolean(session.data && view);

  useEffect(() => {
    if (!canStart) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || isTypingOrControl(event.target))
        return;
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      event.preventDefault();
      void navigate(pathFor({ screen: 'S-03', sessionId }));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [canStart, navigate, sessionId]);

  if (session.isPending) return <div className={styles.screen} aria-busy="true" />;
  if (session.error) {
    return (
      <div className={styles.centered} role="alert">
        {session.error.message}
      </div>
    );
  }
  if (!session.data) return <StubScreen name="Review plan" />;
  const position = (stepId: string) => (view ? view.order.order.indexOf(stepId) + 1 : 0);
  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        <PlanHeader
          title={session.data.mr.title}
          meta={<MrMetaLine session={session.data} />}
          actions={
            <>
              <Button
                size={46}
                className={styles.secondary}
                onClick={() => void navigate(pathFor({ screen: 'S-06', sessionId }))}
              >
                Browse files instead
              </Button>
              <Button
                variant="primary"
                size={46}
                disabled={!canStart}
                onClick={() => void navigate(pathFor({ screen: 'S-03', sessionId }))}
              >
                Start step 1 <span className={styles.enter}>↵</span>
              </Button>
            </>
          }
        />
        {plan.error && !view ? (
          <div className={styles.region} role="alert">
            <p className={styles.failure}>{plan.error.message}</p>
            <div>
              <Button size={36} onClick={() => void plan.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.columns}>
            <div className={styles.main}>
              {fallback ? (
                <FallbackBanner
                  message={fallback.message}
                  retrying={plan.isFetching}
                  onRetry={() => void plan.refetch()}
                />
              ) : (
                <PlanIntent intent={view ? view.plan.intent : null} />
              )}
              {view && (
                <PlanList
                  view={view}
                  onStrategy={(strategy) => {
                    setStrategy.mutate(strategy);
                  }}
                  onReorder={(stepIds) => {
                    reorder.mutate(stepIds);
                  }}
                />
              )}
            </div>
            {view && <PlanAside plan={view.plan} position={position} />}
          </div>
        )}
      </div>
    </div>
  );
}
