import { useCallback, useRef } from 'react';
import type { Finding } from '../../ipc/types/Finding';
import type { PlacedFile } from '../../ipc/types/PlacedFile';
import type { StepAnalysis } from '../../ipc/types/StepAnalysis';
import { NotesRequest } from '../step/notesRequest';
import { AnalysisContext } from './AnalysisContext';
import { AskBox } from './AskBox';
import { CodeNotes } from './CodeNotes';
import { JudgeList } from './JudgeList';
import { useGuideKeys } from './useGuideKeys';
import styles from './Detailed.module.css';

export interface GuideAsideProps {
  sessionId: string;
  stepId: string;
  /** The step's number in the reader's order. */
  stepNumber: number;
  /** The step's notes; undefined while Claude reads the step or when it failed. */
  analysis: StepAnalysis | undefined;
  focused: string | null;
  /** A note picked here (a click or `N`): focused, its callout brought into view. */
  onPick: (findingId: string) => void;
  /** Undefined while the session is looked up: no MR or self-review copy is guessed. */
  selfReview: boolean | undefined;
  /** Every diff file's place for this step (`StepView.places`). */
  places: PlacedFile[] | undefined;
  /** False on a screen restored on start: only cached notes show (F-30.4). */
  request: boolean;
}

const NO_FINDINGS: Finding[] = [];

/**
 * S-04's Guide aside (F-08.7, Main.dc.html): "Claude · step N", Code notes, For you to judge,
 * Analysis context and the Ask box with the answer card above it.
 */
export function GuideAside({
  sessionId,
  stepId,
  stepNumber,
  analysis,
  focused,
  onPick,
  selfReview,
  places,
  request,
}: GuideAsideProps) {
  const findings = analysis?.findings ?? NO_FINDINGS;
  const askRef = useRef<HTMLInputElement>(null);
  const nextNote = useCallback(() => {
    if (findings.length === 0) return;
    const at = findings.findIndex((f) => f.id === focused);
    const next = findings[(at + 1) % findings.length];
    if (next) onPick(next.id);
  }, [findings, focused, onPick]);
  const focusAsk = useCallback(() => {
    askRef.current?.focus();
  }, []);
  useGuideKeys(nextNote, focusAsk);

  return (
    <aside aria-label="Guide" className={styles.guide}>
      <div className={styles.guideHead}>
        <div className={styles.guideName}>
          <span className={styles.guideMark} aria-hidden="true" />
          <span>Guide</span>
        </div>
        <span className={styles.guideStep}>{`Claude · step ${String(stepNumber)}`}</span>
      </div>
      <NotesRequest.Provider value={request}>
        <CodeNotes
          sessionId={sessionId}
          stepId={stepId}
          findings={findings}
          focused={focused}
          onPick={onPick}
          selfReview={selfReview}
        />
      </NotesRequest.Provider>
      {analysis && analysis.checklist.length > 0 && (
        <JudgeList sessionId={sessionId} stepId={stepId} checklist={analysis.checklist} />
      )}
      {analysis && analysis.filesRead.length > 0 && selfReview !== undefined && places && (
        <AnalysisContext filesRead={analysis.filesRead} places={places} selfReview={selfReview} />
      )}
      <AskBox
        sessionId={sessionId}
        stepId={stepId}
        stepNumber={stepNumber}
        selfReview={selfReview}
        inputRef={askRef}
      />
    </aside>
  );
}
