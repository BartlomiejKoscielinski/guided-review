import { useCallback, useState, type RefObject } from 'react';
import { cx } from '../../components/cx';
import { useStep, useStepFindings } from '../../ipc/hooks/useReview';
import { useSessionState, useSessionStateWriter } from '../../ipc/hooks/useSessionState';
import type { Finding } from '../../ipc/types/Finding';
import type { Severity } from '../../ipc/types/Severity';
import { useFocusStore } from '../../state/focus';
import { selectionOf, type AskState } from './askState';
import { GuidePanel } from './GuidePanel';
import { NotesRequest } from './notesRequest';
import { StepMain } from './StepMain';
import { StepToolbar } from './StepToolbar';
import { useMarkReviewed } from './useMarkReviewed';
import { useStepScroll } from './useStepScroll';
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
  /** S-03 restored on start: only cached notes show, no step task runs (F-30.4). */
  restored?: boolean;
}

/**
 * The step of S-03 in the shared layout (F-07.1). It owns the step's state - the focused note and
 * the open answer card - and stays mounted when the layout changes, so A, B and C show the same
 * step, note, scroll position and answer: A the main column, B the same with a floating toolbar,
 * C a guide panel on the right. The step opens where it was scrolled last (F-04.3).
 */
export function StepBody({ sessionId, stepId, mainRef, onGo, restored = false }: StepBodyProps) {
  const layout = useFocusStore((s) => s.layout);
  const step = useStep(sessionId, stepId);
  const { query: notes } = useStepFindings(sessionId, stepId, !restored);
  const findings = notes.data?.findings ?? [];
  const kept = useSessionState(sessionId).data?.scroll[stepId] ?? 0;
  const writer = useSessionStateWriter(sessionId);
  useStepScroll(mainRef, step.data !== undefined && !notes.isFetching, kept, (top) => {
    writer.setScroll(stepId, top);
  });
  const toggleReviewed = useMarkReviewed(sessionId, stepId, step.data?.reviewed);
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

  // The diff's virtualizers look for `main` when they mount and refs attach children first, so
  // the step is drawn into `main` once it is in the page; otherwise they attach later and move it
  // back to the top after its scroll position was restored.
  const [inPage, setInPage] = useState(false);
  const attachMain = useCallback(
    (el: HTMLElement | null) => {
      mainRef.current = el;
      setInPage(el !== null);
    },
    [mainRef],
  );

  const view = step.data;
  return (
    <NotesRequest.Provider value={!restored}>
      <main
        ref={attachMain}
        className={cx(styles.main, layout === 'B' && styles.mainB, layout === 'C' && styles.mainC)}
      >
        {step.isError && (
          <p role="alert" className={styles.error}>
            {step.error.message}
          </p>
        )}
        {view && inPage && (
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
            onToggleReviewed={toggleReviewed}
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
          onToggleReviewed={toggleReviewed}
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
          onToggleReviewed={toggleReviewed}
          onAsk={() => {
            openAsk(null);
          }}
        />
      )}
    </NotesRequest.Provider>
  );
}
