import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { CheckIcon } from '../../components/icons';
import type { Finding } from '../../ipc/types/Finding';
import type { StepAnalysis } from '../../ipc/types/StepAnalysis';
import type { StepView } from '../../ipc/types/StepView';
import { AnswerCard } from './AnswerCard';
import type { AskState } from './askState';
import { NoteCard } from './NoteCard';
import { ProgressSegments } from './ProgressSegments';
import { StepNotes } from './StepNotes';
import { useStepProgress } from './useStepProgress';
import styles from './Guide.module.css';

export interface GuidePanelProps {
  sessionId: string;
  stepId: string;
  view: StepView;
  analysis: StepAnalysis | undefined;
  /** Self-review: notes are kept to fix instead of added to drafts (F-17.2). */
  selfReview: boolean;
  focused: string | null;
  onFocus: (findingId: string) => void;
  /** Mark reviewed or its undo (F-07.2). */
  onToggleReviewed: () => void;
  ask: AskState | null;
  /** A question typed in the panel's input opens the answer card with it. */
  onAskQuestion: (question: string) => void;
  onAsk: (finding: Finding) => void;
  /** Each new value focuses the ask input (A, F-30.6); 0 leaves it. */
  focusAsk?: number;
}

const SUB_LABEL = { fix: 'should fix', q: 'question', nit: 'minor' } as const;

function subLabel(finding: Finding, selfReview: boolean): string {
  if (finding.decision === 'draft') return selfReview ? 'to fix' : 'in drafts';
  if (finding.decision === 'dismissed') return 'dismissed';
  return SUB_LABEL[finding.severity];
}

/**
 * Layout C's guide panel (F-07.7, F-07.6): progress segments, the step's title and description,
 * "Worth a look" with the notes numbered in line order and the focused one expanded, "+N minor",
 * a large Mark reviewed and the "Ask Claude about this step…" input, which becomes the answer
 * card (with its follow-up input) once a question is asked.
 */
export function GuidePanel({
  sessionId,
  stepId,
  view,
  analysis,
  selfReview,
  focused,
  onFocus,
  onToggleReviewed,
  ask,
  onAskQuestion,
  onAsk,
  focusAsk = 0,
}: GuidePanelProps) {
  const { order, reviewed } = useStepProgress(sessionId);
  const [showMinor, setShowMinor] = useState(false);
  const [question, setQuestion] = useState('');
  const askRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusAsk > 0) askRef.current?.focus();
  }, [focusAsk]);
  const findings = analysis?.findings ?? [];
  const numbered = findings.map((finding, i) => ({ finding, number: i + 1 }));
  const isMinor = ({ finding }: { finding: Finding }) =>
    finding.severity === 'nit' && finding.id !== focused;
  const minor = numbered.filter(isMinor);
  const shown = showMinor ? numbered : numbered.filter((n) => !isMinor(n));

  return (
    <aside aria-label="Guide" className={styles.guide}>
      <div className={styles.intro}>
        <div className={styles.progress}>
          <div
            role="img"
            aria-label={`Step ${String(view.number)} of ${String(view.total)}`}
            className={styles.segments}
          >
            <ProgressSegments order={order} current={stepId} reviewed={reviewed} size="guide" />
          </div>
          <span className={styles.kicker}>
            Step {view.number} of {view.total}
          </span>
        </div>
        <h1 className={styles.title}>{view.step.title}</h1>
        <p className={styles.description}>{view.step.description}</p>
      </div>

      <div className={styles.worth}>
        <h2 className={styles.worthHead}>Worth a look</h2>
        {findings.length === 0 && <StepNotes sessionId={sessionId} stepId={stepId} />}
        {shown.map(({ finding, number }) => {
          const on = finding.id === focused;
          const badge = cx(
            styles.badge,
            styles[finding.decision === 'open' ? finding.severity : finding.decision],
          );
          return on ? (
            <div key={finding.id} className={styles.noteOn}>
              <span className={badge}>{number}</span>
              <NoteCard
                finding={finding}
                sessionId={sessionId}
                selfReview={selfReview}
                onAsk={onAsk}
              />
            </div>
          ) : (
            <button
              key={finding.id}
              type="button"
              className={styles.noteOff}
              aria-label={`Note ${String(number)}: ${finding.title}`}
              onClick={() => {
                onFocus(finding.id);
              }}
            >
              <span className={badge}>{number}</span>
              <span className={styles.noteText}>
                <span className={styles.noteTitle}>{finding.title}</span>
                <span className={styles.noteSub}>{subLabel(finding, selfReview)}</span>
              </span>
            </button>
          );
        })}
        {(minor.length > 0 || showMinor) && (
          <button
            type="button"
            className={styles.minor}
            onClick={() => {
              setShowMinor((v) => !v);
            }}
          >
            {showMinor ? 'Hide minor' : `+ ${String(minor.length)} minor`}
          </button>
        )}
      </div>

      <div className={styles.bottom}>
        <Button
          variant="primary"
          size={46}
          className={cx(styles.markReviewed, styles.reviewed)}
          aria-pressed={view.reviewed}
          onClick={onToggleReviewed}
        >
          <CheckIcon size={15} strokeWidth={2.6} />
          {view.reviewed ? 'Reviewed' : 'Mark reviewed'}
        </Button>
        {ask ? (
          <AnswerCard
            key={ask.nonce}
            nonce={ask.nonce}
            sessionId={sessionId}
            stepId={stepId}
            selection={ask.selection}
            selfReview={selfReview}
            autoFocus={ask.focusInput}
            focus={ask.focus}
            initialQuestion={ask.question}
          />
        ) : (
          <form
            className={styles.askForm}
            onSubmit={(event) => {
              event.preventDefault();
              const q = question.trim();
              if (q === '') return;
              setQuestion('');
              onAskQuestion(q);
            }}
          >
            <input
              ref={askRef}
              className={styles.askInput}
              aria-label="Ask Claude about this step"
              placeholder="Ask Claude about this step…"
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
              }}
            />
          </form>
        )}
      </div>
    </aside>
  );
}
