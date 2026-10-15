import { useMatches, useNavigate, useSearchParams } from 'react-router';
import { useSessionState } from '../../ipc/hooks/useSessionState';
import type { Mode } from '../../ipc/types/Mode';
import { currentStep } from '../../screens/step/currentStep';
import { ProgressSegments } from '../../screens/step/ProgressSegments';
import { useStepProgress } from '../../screens/step/useStepProgress';
import { useFocusStore } from '../../state/focus';
import { pathFor } from '../routes';
import { useModeSwitch } from '../useModeSwitch';
import { TaskModelChip } from './TaskModelChip';
import { ReviewContext } from './ReviewContext';
import { StepControls } from './StepControls';
import { TitleBar } from './TitleBar';
import styles from './StepTitleBar.module.css';

/**
 * S-03 and S-04 title bar (docs/02 › Shell): the session's context, the Focus | Detailed toggle
 * (F-08.1) and, in Focus, the layout switch (F-07.1) and, in layout B, the progress segments in
 * the middle (F-07.8); a click on them goes back to the plan.
 */
export function StepTitleBar({ mode = 'focus' }: { mode?: Mode }) {
  const modeSwitch = useModeSwitch();
  const layout = useFocusStore((s) => s.layout);
  const setLayout = useFocusStore((s) => s.setLayout);
  const sessionId = useMatches().at(-1)?.params.sessionId ?? '';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // Cached by the screen; this never starts a plan (F-30.4).
  const { order, reviewed } = useStepProgress(sessionId);
  const kept = useSessionState(sessionId).data?.currentStep;
  const current = currentStep(params.get('step'), kept, order) ?? '';
  const index = Math.max(0, order.indexOf(current));

  const center =
    mode === 'focus' && layout === 'B' && order.length > 0 ? (
      <button
        type="button"
        className={styles.segments}
        aria-label={`Review plan: step ${String(index + 1)} of ${String(order.length)}`}
        onClick={() => {
          void navigate(pathFor({ screen: 'S-02', sessionId }));
        }}
      >
        <ProgressSegments
          order={order}
          current={order[index] ?? ''}
          reviewed={reviewed}
          size="bar"
        />
      </button>
    ) : undefined;

  return (
    <TitleBar
      context={<ReviewContext />}
      center={center}
      controls={
        <StepControls
          mode={mode}
          onMode={modeSwitch?.set}
          layout={layout}
          onLayout={setLayout}
          model={<TaskModelChip group="step" />}
        />
      }
    />
  );
}
