import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useStepFindings } from '../../ipc/hooks/useReview';
import { reviewKey, useReviewStore } from '../../state/review';
import { useStepSession } from '../step/useStepSession';
import { DetailedStepHeader } from './DetailedStepHeader';
import { InfoHeader } from './InfoHeader';
import { Rail } from './Rail';
import styles from './Detailed.module.css';

/**
 * S-04 Step review in Detailed mode (F-08.1, ADR-010): the regions of Main.dc.html - info header
 * (F-08.2), rail (F-08.3), main with the step (F-08.4 to F-08.6, F-08.9), Guide aside (F-08.7)
 * and footer (F-08.8). It shows the same session state as S-03: the step comes from `?step=` or
 * the session (`useStepSession`), and the step's focused note, selected lines and answer stay in
 * `state/review.ts` across a mode switch.
 */
export function DetailedScreen() {
  const { sessionId = '' } = useParams();
  const { view, order, stepId, ready, restored } = useStepSession(sessionId);
  const step = ready ? view?.plan.steps.find((s) => s.id === stepId) : undefined;
  const index = step ? order.indexOf(step.id) : -1;
  // The step's notes as S-03 asks for them (F-09.6); restored on start only cached ones (F-30.4).
  const notes = useStepFindings(sessionId, step?.id ?? '', !restored).query.data;
  const openNotes = notes?.findings.filter((f) => f.decision === 'open').length;

  // The step is open here as in S-03: another step's state is dropped, this step's is kept.
  const claim = useReviewStore((s) => s.claim);
  const key = step ? reviewKey(sessionId, step.id) : null;
  useEffect(() => {
    if (key !== null) claim(key);
  }, [claim, key]);

  return (
    <div className={styles.screen}>
      <InfoHeader sessionId={sessionId} stepId={step?.id} />
      <div className={styles.body}>
        <Rail sessionId={sessionId} view={view} current={step?.id} openNotes={openNotes} />
        <main className={styles.main}>
          {step && view && <DetailedStepHeader sessionId={sessionId} view={view} step={step} />}
        </main>
        <aside aria-label="Guide" className={styles.guide}>
          <div className={styles.guideHead}>
            <div className={styles.guideName}>
              <span className={styles.guideMark} aria-hidden="true" />
              <span>Guide</span>
            </div>
            {index >= 0 && (
              <span className={styles.guideStep}>{`Claude · step ${String(index + 1)}`}</span>
            )}
          </div>
        </aside>
      </div>
      <footer className={styles.footer} />
    </div>
  );
}
