import type { RefObject } from 'react';
import { useFinishReview } from '../../app/titlebar/useFinishReview';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { CheckIcon, ChevronRightIcon } from '../../components/icons';
import type { Finding } from '../../ipc/types/Finding';
import type { StepAnalysis } from '../../ipc/types/StepAnalysis';
import type { StepView } from '../../ipc/types/StepView';
import type { FocusLayout } from '../../state/focus';
import { AnswerCard } from './AnswerCard';
import type { AskState } from './askState';
import { pathOf } from './diffPath';
import { StepFile, type StepFileProps } from './StepFile';
import { StepNotes } from './StepNotes';
import type { FileMarks } from './useFileMarks';
import type { CurrentChange } from './useArrowWalk';
import styles from './Step.module.css';

export interface StepMainProps {
  sessionId: string;
  stepId: string;
  layout: FocusLayout;
  view: StepView;
  analysis: StepAnalysis | undefined;
  /** Self-review: notes are kept to fix instead of added to drafts (F-17.2). */
  selfReview: boolean;
  focused: string | null;
  onFocus: (findingId: string) => void;
  mainRef: RefObject<HTMLElement | null>;
  onGo: (stepId: string) => void;
  /** Mark reviewed or its undo (F-07.2). */
  onToggleReviewed: () => void;
  ask: AskState | null;
  onAsk: (finding: Finding) => void;
  /** The step's selected lines with their "Selected lines" group (F-10.1). */
  selected: StepFileProps['selected'];
  onPickLine: NonNullable<StepFileProps['onPickLine']>;
  /** The step's line comments and the open composer (F-09.7). */
  comments: StepFileProps['comments'];
  /** The change the arrow keys made current (F-30.6). */
  current?: CurrentChange | null;
  /** A note N picked: its card comes into view once per `nonce` (F-30.6). */
  noteReveal?: { id: string; nonce: number } | null;
  /** The step's file marks: each file header's Reviewed toggle (F-07.10). */
  marks?: FileMarks;
}

/**
 * The step in the main column (F-07.2): "STEP n OF m", title, description, Mark reviewed and
 * next (layout A; B has its toolbar, C its guide panel); on the last step next opens S-05 (F-30.3,
 * M4 decision 11). The notes state while there are no cards; the step's files. The diff is there
 * before Claude's notes.
 */
export function StepMain({
  sessionId,
  stepId,
  layout,
  view,
  analysis,
  selfReview,
  focused,
  onFocus,
  mainRef,
  onGo,
  onToggleReviewed,
  ask,
  onAsk,
  selected,
  onPickLine,
  comments,
  current,
  noteReveal,
  marks,
}: StepMainProps) {
  const findings = analysis?.findings ?? [];
  const next = view.next;
  const finishReview = useFinishReview();
  const guide = layout === 'C';
  const answerNode =
    ask && !guide ? (
      <AnswerCard
        key={ask.nonce}
        nonce={ask.nonce}
        sessionId={sessionId}
        stepId={stepId}
        selection={ask.selection}
        selfReview={selfReview}
        autoFocus={ask.focusInput}
        focus={ask.focus}
      />
    ) : null;

  return (
    <>
      {!guide && (
        <section className={styles.header}>
          <div className={styles.heading}>
            <span className={styles.kicker}>
              Step {view.number} of {view.total}
            </span>
            <h1 className={layout === 'B' ? styles.titleB : styles.title}>{view.step.title}</h1>
            <p className={styles.description}>{view.step.description}</p>
          </div>
          {layout === 'A' && (
            <div className={styles.headActions}>
              <Button
                size={38}
                className={cx(styles.markReviewed, styles.reviewed)}
                aria-pressed={view.reviewed}
                onClick={onToggleReviewed}
              >
                <CheckIcon size={14} strokeWidth={2.6} />
                {view.reviewed ? 'Reviewed' : 'Mark reviewed'}
              </Button>
              <button
                type="button"
                className={styles.next}
                aria-label="Next step"
                onClick={() => {
                  if (next !== undefined) onGo(next);
                  else finishReview();
                }}
              >
                <ChevronRightIcon size={16} strokeWidth={2.2} />
              </button>
            </div>
          )}
        </section>
      )}
      {!guide && findings.length === 0 && (
        <div className={styles.notesState}>
          <StepNotes sessionId={sessionId} stepId={stepId} selfReview={selfReview} onAsk={onAsk} />
        </div>
      )}
      {ask && !ask.selection && answerNode && <div className={styles.answerTop}>{answerNode}</div>}
      {view.files.map((file) => {
        const path = pathOf(file);
        const sel = ask?.selection;
        return (
          <StepFile
            key={path}
            sessionId={sessionId}
            stepId={stepId}
            file={file}
            findings={findings
              .map((finding, i) => ({ finding, number: i + 1 }))
              .filter(({ finding }) => finding.file === path)}
            folds={analysis?.folds.filter((f) => f.file === path) ?? []}
            threads={view.threads.filter(
              (t) => t.position?.newPath === path || t.position?.oldPath === path,
            )}
            focus={focused}
            onFocus={onFocus}
            scrollRoot={mainRef}
            selfReview={selfReview}
            onAsk={onAsk}
            guide={guide}
            answer={
              sel && answerNode
                ? {
                    file: sel.file,
                    side: sel.side,
                    line: sel.end,
                    node: answerNode,
                    reveal: ask.focus,
                  }
                : undefined
            }
            selected={selected}
            onPickLine={onPickLine}
            comments={comments}
            current={current?.file === path ? current : undefined}
            revealFocus={noteReveal?.id === focused ? noteReveal.nonce : undefined}
            reviewed={marks?.isReviewed(path)}
            onReviewed={
              marks
                ? () => {
                    marks.toggle(path);
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
}
