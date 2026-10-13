import { useRef } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';
import type { StartState } from '../../app/router';
import { usePlan } from '../../ipc/hooks/usePlan';
import type { Step } from '../../ipc/types/Step';
import { cx } from '../../components/cx';
import { useFocusStore } from '../../state/focus';
import { StepBody } from './StepBody';
import { StepsList } from './StepsList';
import styles from './Step.module.css';

/**
 * S-03 Step review in Focus mode, layouts A, B and C (F-07.1): in A the steps list left and the step in
 * the main column, B without the list and with a floating toolbar, C with a guide panel. The current step is `?step=`, step 1 of the reader's order by default.
 */
export function StepScreen() {
  const { sessionId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  // Restored on start: no plan request, since an uncached plan would run Claude (F-30.4).
  const restored = (useLocation().state as StartState | null)?.restored === true;
  const { query } = usePlan(sessionId, !restored);
  const mainRef = useRef<HTMLElement>(null);
  const layout = useFocusStore((s) => s.layout);
  const view = query.data;
  const order = view?.order.order ?? [];
  const stepId = params.get('step') ?? order[0] ?? '';

  const steps = order
    .map((id) => view?.plan.steps.find((s) => s.id === id))
    .filter((s): s is Step => s !== undefined);
  const skimFiles = view?.skimStats.reduce((sum, s) => sum + s.files, 0) ?? 0;
  const go = (id: string) => {
    setParams({ step: id });
    if (mainRef.current) mainRef.current.scrollTop = 0;
  };

  return (
    <div className={styles.screen}>
      {layout === 'A' && steps.length > 0 && (
        <StepsList steps={steps} current={stepId} skimFiles={skimFiles} onSelect={go} />
      )}
      {/* review_step needs the plan's remembered context. */}
      {view !== undefined && stepId !== '' ? (
        <StepBody key={stepId} sessionId={sessionId} stepId={stepId} mainRef={mainRef} onGo={go} />
      ) : (
        <main ref={mainRef} className={cx(styles.main)} />
      )}
    </div>
  );
}
