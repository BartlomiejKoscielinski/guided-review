import { useMatches, useNavigate, useSearchParams } from 'react-router';
import { usePlan } from '../../ipc/hooks/usePlan';
import { useSessionState } from '../../ipc/hooks/useSessionState';
import { currentStep } from '../../screens/step/currentStep';
import { ProgressSegments } from '../../screens/step/ProgressSegments';
import { useFocusStore } from '../../state/focus';
import { pathFor } from '../routes';
import { TaskModelChip } from './TaskModelChip';
import { SessionContext, StepControls } from './StepControls';
import { TitleBar } from './TitleBar';
import styles from './StepTitleBar.module.css';

/**
 * S-03 title bar (docs/02 › Shell): context, the Focus | Detailed toggle, the layout switch
 * (F-07.1) and, in layout B, the progress segments in the middle (F-07.8); a click on them goes
 * back to the plan.
 */
export function StepTitleBar() {
  const layout = useFocusStore((s) => s.layout);
  const setLayout = useFocusStore((s) => s.setLayout);
  const sessionId = useMatches().at(-1)?.params.sessionId ?? '';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // Cached by the screen; this never starts a plan (F-30.4).
  const plan = usePlan(sessionId, false).query.data;
  const kept = useSessionState(sessionId).data?.currentStep;
  const order = plan?.order.order ?? [];
  const index = Math.max(0, order.indexOf(currentStep(params.get('step'), kept, order) ?? ''));

  const center =
    layout === 'B' && order.length > 0 ? (
      <button
        type="button"
        className={styles.segments}
        aria-label={`Review plan: step ${String(index + 1)} of ${String(order.length)}`}
        onClick={() => {
          void navigate(pathFor({ screen: 'S-02', sessionId }));
        }}
      >
        <ProgressSegments total={order.length} current={index + 1} size="bar" />
      </button>
    ) : undefined;

  return (
    <TitleBar
      context={<SessionContext />}
      center={center}
      controls={
        <StepControls
          mode="focus"
          layout={layout}
          onLayout={setLayout}
          model={<TaskModelChip group="step" />}
        />
      }
    />
  );
}
