import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useStep, useStepFindings } from '../../ipc/hooks/useReview';
import type { Finding } from '../../ipc/types/Finding';
import { reviewKey, useReviewStore } from '../../state/review';
import { selectionOf } from '../step/askState';
import { pathOf } from '../step/diffPath';
import { useSelfReviewKnown } from '../step/useSelfReview';
import { useStepFocus } from '../step/useStepFocus';
import { useStepSession } from '../step/useStepSession';
import { DetailedFile } from './DetailedFile';
import { DetailedStepHeader } from './DetailedStepHeader';
import { Footer } from './Footer';
import { GuideAside } from './GuideAside';
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
  const findings = notes?.findings ?? [];
  const openNotes = notes?.findings.filter((f) => f.decision === 'open').length;
  const selfReview = useSelfReviewKnown(sessionId);
  // The step's files with only its hunks (F-07.3), each under its sticky file bar (F-08.5); a
  // failed read shows its message under the step header, as S-03 does (S-04 states: same as S-03).
  const files = useStep(sessionId, step?.id ?? '');
  const mainRef = useRef<HTMLElement>(null);

  // The step is open here as in S-03: another step's state is dropped, this step's is kept.
  const claim = useReviewStore((s) => s.claim);
  const change = useReviewStore((s) => s.change);
  const key = step ? reviewKey(sessionId, step.id) : null;
  useEffect(() => {
    if (key !== null) claim(key);
  }, [claim, key]);
  // The focused note as in S-03 (its callout opens under its line, F-08.6); Ask Claude on it asks
  // about the note's line, the same ask S-03 opens, so a mode switch keeps it (F-08.1).
  const { focused, setFocus } = useStepFocus(key ?? '', findings);
  // A note picked in the Guide aside (a click or `N`) also brings its callout into view (F-08.7).
  const [reveal, setReveal] = useState<{ id: string; nonce: number } | null>(null);
  const onPick = useCallback(
    (id: string) => {
      setFocus(id);
      setReveal((r) => ({ id, nonce: (r?.nonce ?? 0) + 1 }));
    },
    [setFocus],
  );
  const onAsk = (finding: Finding) => {
    if (key === null) return;
    change(key, (s) => ({
      ask: { selection: selectionOf(finding), focusInput: true, nonce: (s.ask?.nonce ?? 0) + 1 },
    }));
  };

  return (
    <div className={styles.screen}>
      <InfoHeader sessionId={sessionId} stepId={step?.id} />
      <div className={styles.body}>
        <Rail sessionId={sessionId} view={view} current={step?.id} openNotes={openNotes} />
        <main ref={mainRef} className={styles.main}>
          {step && view && <DetailedStepHeader sessionId={sessionId} view={view} step={step} />}
          {step && files.isError && (
            <p role="alert" className={styles.error}>
              {files.error.message}
            </p>
          )}
          {step &&
            files.data?.files.map((file) => (
              <DetailedFile
                key={pathOf(file)}
                sessionId={sessionId}
                file={file}
                scrollRoot={mainRef}
                findings={findings
                  .map((finding, i) => ({ finding, number: i + 1 }))
                  .filter(({ finding }) => finding.file === pathOf(file))}
                focus={focused}
                onFocus={setFocus}
                selfReview={selfReview}
                onAsk={onAsk}
                reveal={reveal?.id === focused ? reveal.nonce : undefined}
              />
            ))}
        </main>
        {step && index >= 0 ? (
          <GuideAside
            sessionId={sessionId}
            stepId={step.id}
            stepNumber={index + 1}
            analysis={notes}
            focused={focused}
            onPick={onPick}
            selfReview={selfReview}
            places={files.data?.places}
            request={!restored}
          />
        ) : (
          <aside aria-label="Guide" className={styles.guide} />
        )}
      </div>
      <Footer sessionId={sessionId} order={order} current={step?.id} />
    </div>
  );
}
