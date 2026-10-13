import { useState, type RefObject } from 'react';
import { Button } from '../../components/Button';
import { CheckIcon, ChevronRightIcon } from '../../components/icons';
import { useStep, useStepFindings } from '../../ipc/hooks/useReview';
import { pathOf } from './diffPath';
import { StepFile } from './StepFile';
import { StepNotes } from './StepNotes';
import styles from './Step.module.css';

export interface StepMainProps {
  sessionId: string;
  stepId: string;
  mainRef: RefObject<HTMLElement | null>;
  onGo: (stepId: string) => void;
}

/**
 * The step in layout A's main column (F-07.2): "STEP n OF m", title, description, Mark reviewed
 * and next; the notes state while there are no cards; the step's files. The diff is there before
 * Claude's notes.
 */
export function StepMain({ sessionId, stepId, mainRef, onGo }: StepMainProps) {
  const step = useStep(sessionId, stepId);
  const { query: notes } = useStepFindings(sessionId, stepId);
  const findings = notes.data?.findings ?? [];
  const [focus, setFocus] = useState<string | null>(null);
  const focused = focus ?? findings[0]?.id ?? null;

  if (step.isError) {
    return (
      <p role="alert" className={styles.error}>
        {step.error.message}
      </p>
    );
  }
  const view = step.data;
  if (!view) return null;
  const next = view.next;

  return (
    <>
      <section className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.kicker}>
            Step {view.number} of {view.total}
          </span>
          <h1 className={styles.title}>{view.step.title}</h1>
          <p className={styles.description}>{view.step.description}</p>
        </div>
        <div className={styles.headActions}>
          {/* Wired with `review_mark_step` (sidebar checks, Space). */}
          <Button size={38} className={styles.markReviewed} aria-pressed={view.reviewed} disabled>
            <CheckIcon size={14} strokeWidth={2.6} />
            {view.reviewed ? 'Reviewed' : 'Mark reviewed'}
          </Button>
          <button
            type="button"
            className={styles.next}
            aria-label="Next step"
            disabled={next === undefined}
            onClick={() => {
              if (next !== undefined) onGo(next);
            }}
          >
            <ChevronRightIcon size={16} strokeWidth={2.2} />
          </button>
        </div>
      </section>
      {findings.length === 0 && (
        <div className={styles.notesState}>
          <StepNotes sessionId={sessionId} stepId={stepId} />
        </div>
      )}
      {view.files.map((file) => {
        const path = pathOf(file);
        return (
          <StepFile
            key={path}
            sessionId={sessionId}
            file={file}
            findings={findings
              .map((finding, i) => ({ finding, number: i + 1 }))
              .filter(({ finding }) => finding.file === path)}
            folds={notes.data?.folds.filter((f) => f.file === path) ?? []}
            threads={view.threads.filter(
              (t) => t.position?.newPath === path || t.position?.oldPath === path,
            )}
            focus={focused}
            onFocus={setFocus}
            scrollRoot={mainRef}
          />
        );
      })}
    </>
  );
}
