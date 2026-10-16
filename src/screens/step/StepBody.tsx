import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useFinishReview } from '../../app/titlebar/useFinishReview';
import { cx } from '../../components/cx';
import { useStep, useStepFindings } from '../../ipc/hooks/useReview';
import { useSessionState, useSessionStateWriter } from '../../ipc/hooks/useSessionState';
import { useFocusStore } from '../../state/focus';
import { reviewKey, useReviewStore, useStepReview } from '../../state/review';
import { selectionOf, type AskState } from './askState';
import { GuidePanel } from './GuidePanel';
import { NotesRequest } from './notesRequest';
import { SelectionBar } from './SelectionBar';
import { StepMain } from './StepMain';
import { StepToolbar } from './StepToolbar';
import { lastLine, nextNonce } from './lineComment';
import { useLineComments } from './useLineComments';
import { useLineSelection } from './useLineSelection';
import { useMarkReviewed } from './useMarkReviewed';
import { useReviewKeys } from './useReviewKeys';
import { useSelfReview } from './useSelfReview';
import { useStepFocus } from './useStepFocus';
import { useStepScroll } from './useStepScroll';
import { useStepKeys } from './useStepKeys';
import styles from './Step.module.css';

export interface StepBodyProps {
  sessionId: string;
  stepId: string;
  mainRef: RefObject<HTMLElement | null>;
  onGo: (stepId: string) => void;
  /** S-03 restored on start: only cached notes show, no step task runs (F-30.4). */
  restored?: boolean;
}

/**
 * The step of S-03 in the shared layout (F-07.1). It stays mounted when the layout changes, so A,
 * B and C show the same step, note, scroll position and answer: A the main column, B the same with
 * a floating toolbar, C a guide panel on the right. The step's state - the focused note, the
 * selected lines and the open answer card - is kept in `state/review.ts`, so S-04 and S-03 show
 * the same state after a mode switch (F-08.1). The step opens where it was scrolled last (F-04.3).
 */
export function StepBody({ sessionId, stepId, mainRef, onGo, restored = false }: StepBodyProps) {
  const layout = useFocusStore((s) => s.layout);
  const step = useStep(sessionId, stepId);
  const selfReview = useSelfReview(sessionId);
  const { query: notes } = useStepFindings(sessionId, stepId, !restored);
  const findings = notes.data?.findings ?? [];
  const kept = useSessionState(sessionId).data?.scroll[stepId] ?? 0;
  const writer = useSessionStateWriter(sessionId);
  useStepScroll(mainRef, step.data !== undefined && !notes.isFetching, kept, (top) => {
    writer.setScroll(stepId, top);
  });
  const toggleReviewed = useMarkReviewed(sessionId, stepId, step.data?.reviewed);
  const key = reviewKey(sessionId, stepId);
  const claim = useReviewStore((s) => s.claim);
  const change = useReviewStore((s) => s.change);
  useEffect(() => {
    claim(key);
  }, [claim, key]);
  const ask = useStepReview(key, 'ask');
  const { focused, setFocus } = useStepFocus(key, findings);

  const openAsk = (selection: AskState['selection'], question?: string) => {
    change(key, (s) => ({
      ask: { selection, question, focusInput: true, nonce: (s.ask?.nonce ?? 0) + 1 },
    }));
  };
  // Questions from the toolbar, the guide and the "Selected lines" group are about the selected
  // lines, if any; otherwise about the whole step (F-10.1).
  const lines = useLineSelection(key);
  // The review keys (F-30.6): [ ] steps (the last step's ] finishes, F-30.3), J/K hunks, N notes
  // (the picked note's card comes into view), D/X decide, A asks (an open answer card keeps its
  // answer and takes the focus), Ctrl+Shift+O Rider.
  const finishReview = useFinishReview();
  useStepKeys(
    step.data?.prev,
    step.data?.next,
    onGo,
    step.data && step.data.next === undefined ? finishReview : undefined,
  );
  const [noteReveal, setNoteReveal] = useState<{ id: string; nonce: number } | null>(null);
  // Layout C's ask field in the guide panel, focused by A while no answer card is open there.
  const [guideAsk, setGuideAsk] = useState(0);
  const keys = useReviewKeys({
    sessionId,
    stepId,
    files: step.data?.files ?? [],
    findings,
    focused,
    selection: lines.selection,
    onNote: (id) => {
      setFocus(id);
      setNoteReveal({ id, nonce: nextNonce() });
    },
    onAsk: () => {
      if (ask) change(key, (s) => (s.ask ? { ask: { ...s.ask, focus: nextNonce() } } : {}));
      else if (layout === 'C') setGuideAsk((n) => n + 1);
      else openAsk(lines.selection);
    },
  });
  // Line comments (F-09.7): C or Comment opens the composer under the last selected line, else in
  // the hunk J/K made current (M4 decision 13).
  const comments = useLineComments({
    sessionId,
    stepId,
    files: step.data?.files ?? [],
    folds: notes.data?.folds ?? [],
    selfReview,
    current: keys.current,
  });
  const selected = lines.selection && {
    selection: lines.selection,
    bar: (
      <SelectionBar
        selection={lines.selection}
        onAsk={() => {
          openAsk(lines.selection);
        }}
        onComment={() => {
          if (lines.selection) comments.open(lastLine(lines.selection));
        }}
        onClear={lines.clear}
      />
    ),
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
        {keys.error && (
          <p role="alert" className={styles.error}>
            {keys.error.message}
          </p>
        )}
        {view && inPage && (
          <StepMain
            sessionId={sessionId}
            stepId={stepId}
            layout={layout}
            view={view}
            analysis={notes.data}
            selfReview={selfReview}
            focused={focused}
            onFocus={setFocus}
            mainRef={mainRef}
            onGo={onGo}
            onToggleReviewed={toggleReviewed}
            ask={ask}
            onAsk={(finding) => {
              openAsk(selectionOf(finding));
            }}
            selected={selected}
            onPickLine={lines.pick}
            comments={comments.cards}
            current={keys.current}
            noteReveal={noteReveal}
          />
        )}
      </main>
      {view && layout === 'C' && (
        <GuidePanel
          sessionId={sessionId}
          stepId={stepId}
          view={view}
          analysis={notes.data}
          selfReview={selfReview}
          focused={focused}
          onFocus={setFocus}
          ask={ask}
          onToggleReviewed={toggleReviewed}
          focusAsk={guideAsk}
          onAskQuestion={(question) => {
            openAsk(lines.selection, question);
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
            openAsk(lines.selection);
          }}
        />
      )}
    </NotesRequest.Provider>
  );
}
