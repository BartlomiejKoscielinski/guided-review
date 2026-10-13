import { useState, type RefObject } from 'react';
import { cx } from '../../components/cx';
import { useStep, useStepFindings } from '../../ipc/hooks/useReview';
import type { Finding } from '../../ipc/types/Finding';
import type { Severity } from '../../ipc/types/Severity';
import { useFocusStore } from '../../state/focus';
import { selectionOf, type AskState } from './askState';
import { GuidePanel } from './GuidePanel';
import { StepMain } from './StepMain';
import { StepToolbar } from './StepToolbar';
import styles from './Step.module.css';

const SEVERITY_RANK: Record<Severity, number> = { fix: 0, q: 1, nit: 2 };

/**
 * The note focused when a step opens: the first open note of the highest severity (Review.dc.html
 * opens on its first Should fix, f2), else the first note.
 */
function firstFocus(findings: Finding[]): string | null {
  const open = findings.filter((f) => f.decision === 'open');
  const pick = [...open].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
  return pick?.id ?? findings[0]?.id ?? null;
}

export interface StepBodyProps {
  sessionId: string;
  stepId: string;
  mainRef: RefObject<HTMLElement | null>;
  onGo: (stepId: string) => void;
}

/**
 * The step of S-03 in the shared layout (F-07.1). It owns the step's state - the focused note and
 * the open answer card - and stays mounted when the layout changes, so A, B and C show the same
 * step, note, scroll position and answer: A the main column, B the same with a floating toolbar,
 * C a guide panel on the right.
 */
export function StepBody({ sessionId, stepId, mainRef, onGo }: StepBodyProps) {
  const layout = useFocusStore((s) => s.layout);
  const step = useStep(sessionId, stepId);
  const { query: notes } = useStepFindings(sessionId, stepId);
  const findings = notes.data?.findings ?? [];
  const [focus, setFocus] = useState<string | null>(null);
  const [ask, setAsk] = useState<AskState | null>(null);
  // Picked once per set of notes, so deciding the focused note doesn't move the focus away.
  const [initial, setInitial] = useState<{ ids: string; id: string | null } | null>(null);
  const ids = findings.map((f) => f.id).join(' ');
  if (initial?.ids !== ids) setInitial({ ids, id: firstFocus(findings) });
  const focused = focus ?? (initial?.ids === ids ? initial.id : firstFocus(findings));

  const openAsk = (selection: AskState['selection'], question?: string) => {
    setAsk((old) => ({ selection, question, focusInput: true, nonce: (old?.nonce ?? 0) + 1 }));
  };

  const view = step.data;
  return (
    <>
      <main
        ref={mainRef}
        className={cx(styles.main, layout === 'B' && styles.mainB, layout === 'C' && styles.mainC)}
      >
        {step.isError && (
          <p role="alert" className={styles.error}>
            {step.error.message}
          </p>
        )}
        {view && (
          <StepMain
            sessionId={sessionId}
            stepId={stepId}
            layout={layout}
            view={view}
            analysis={notes.data}
            focused={focused}
            onFocus={setFocus}
            mainRef={mainRef}
            onGo={onGo}
            ask={ask}
            onAsk={(finding) => {
              openAsk(selectionOf(finding));
            }}
          />
        )}
      </main>
      {view && layout === 'C' && (
        <GuidePanel
          sessionId={sessionId}
          stepId={stepId}
          view={view}
          analysis={notes.data}
          focused={focused}
          onFocus={setFocus}
          ask={ask}
          onAskQuestion={(question) => {
            openAsk(null, question);
          }}
          onAsk={(finding) => {
            openAsk(selectionOf(finding));
          }}
        />
      )}
      {view && layout === 'B' && (
        <StepToolbar
          view={view}
          onGo={onGo}
          onAsk={() => {
            openAsk(null);
          }}
        />
      )}
    </>
  );
}
