import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Button } from '../../components/Button';
import { useAsk } from '../../ipc/hooks/useAsk';
import { reviewKey, useReviewStore, useStepReview } from '../../state/review';
import { AnswerCard } from '../step/AnswerCard';
import { pickedSelection } from '../step/lineSelection';
import { askContextLabel } from './askContext';
import styles from './GuideAside.module.css';

export interface AskBoxProps {
  sessionId: string;
  stepId: string;
  /** The step's number in the reader's order ("step 4"). */
  stepNumber: number;
  /** Self-review copy on the answer card; undefined while the session is looked up. */
  selfReview: boolean | undefined;
  /** The input, focused by `A` and by Ask Claude on a callout. */
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * The Guide aside's Ask box (F-08.7, M4 decision 7): "Ask about this step or the selected code"
 * with its context ("step 4", "step 4 · L46–L57") and Ask `Ctrl+↵`. The answer card shows right
 * above it; a question while the card is open is a follow-up in it (F-10.2). The context is the
 * open card's lines (Ask Claude on a callout or on selected lines), else the selected lines.
 */
export function AskBox({ sessionId, stepId, stepNumber, selfReview, inputRef }: AskBoxProps) {
  const inputId = useId();
  const key = reviewKey(sessionId, stepId);
  const ask = useStepReview(key, 'ask');
  const picked = useStepReview(key, 'picked');
  const change = useReviewStore((s) => s.change);
  const nonce = ask?.nonce ?? 0;
  const { thread, ask: askAgain } = useAsk(sessionId, stepId, nonce);
  const [question, setQuestion] = useState('');
  const selection = ask ? ask.selection : picked ? pickedSelection(picked) : null;
  const answering = thread?.asking === true;
  // No empty card: it shows once a question was asked in it.
  const asked = (thread?.question ?? ask?.question ?? null) !== null;

  // Ask Claude on a callout opens a new card request with the input focused: the focus comes here.
  const seen = useRef(nonce);
  const focusInput = ask?.focusInput === true;
  useEffect(() => {
    if (seen.current === nonce) return;
    seen.current = nonce;
    if (focusInput) inputRef.current?.focus();
  }, [nonce, focusInput, inputRef]);

  const send = () => {
    const q = question.trim();
    if (q === '' || answering) return;
    setQuestion('');
    if (ask === null) {
      change(key, (s) => ({
        ask: { selection, question: q, focusInput: false, nonce: (s.ask?.nonce ?? 0) + 1 },
      }));
    } else {
      askAgain(q, ask.selection);
    }
  };

  return (
    <div className={styles.ask}>
      {ask !== null && asked && (
        <div className={styles.answer}>
          <AnswerCard
            key={ask.nonce}
            nonce={ask.nonce}
            sessionId={sessionId}
            stepId={stepId}
            selection={ask.selection}
            selfReview={selfReview === true}
            initialQuestion={ask.question}
            followUp={false}
          />
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor={inputId} className={styles.askLabel}>
          Ask about this step or the selected code
        </label>
        <div className={styles.askBox}>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            className={styles.askInput}
            placeholder="E.g. can the worker upload the same photo twice?"
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !event.ctrlKey) return;
              event.preventDefault();
              send();
            }}
          />
          <div className={styles.askRow}>
            <span className={styles.askContext}>{askContextLabel(stepNumber, selection)}</span>
            <Button type="submit" variant="claude" disabled={question.trim() === '' || answering}>
              Ask <span className={styles.askKeys}>Ctrl+↵</span>
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
