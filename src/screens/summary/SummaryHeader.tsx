import { useLocation, useNavigate } from 'react-router';
import type { StartState } from '../../app/router';
import { pathFor, stepScreen } from '../../app/routes';
import { Button } from '../../components/Button';
import { ChevronLeftIcon } from '../../components/icons';
import { useResume, useSessionState } from '../../ipc/hooks/useSessionState';
import { useStepProgress } from '../step/useStepProgress';
import { progressLine } from './checklist';
import styles from './Summary.module.css';

export interface SummaryHeaderProps {
  sessionId: string;
}

/**
 * The head of S-05 (SummaryDesk.dc.html), the same in an MR session (F-12.1) and a self-review
 * (F-17.4): "SUMMARY", the progress line "All N steps reviewed." / "N of M steps reviewed." and
 * Back to steps. The progress line is left out while the session has no plan, never "All 0 steps".
 */
export function SummaryHeader({ sessionId }: SummaryHeaderProps) {
  const navigate = useNavigate();
  // Back to step review in the session's mode (F-08.1).
  const mode = useSessionState(sessionId).data?.mode;
  // Restored on start the plan isn't cached yet: the stored one, reviewed marks included, is put
  // where the progress reads it, from stored data only, as S-03 does (F-30.4).
  const restored = (useLocation().state as StartState | null)?.restored === true;
  useResume(sessionId, restored);
  // The plan the steps screen cached; this never starts a plan (F-30.4).
  const { order, reviewed } = useStepProgress(sessionId);
  const done = order.filter((id) => reviewed.includes(id)).length;

  return (
    <section className={styles.header}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Summary</h1>
        {order.length > 0 && <p className={styles.progress}>{progressLine(done, order.length)}</p>}
      </div>
      <Button
        size={38}
        className={styles.back}
        onClick={() => {
          void navigate(pathFor({ screen: stepScreen(mode), sessionId }));
        }}
      >
        <ChevronLeftIcon size={14} strokeWidth={2.4} />
        Back to steps
      </Button>
    </section>
  );
}
