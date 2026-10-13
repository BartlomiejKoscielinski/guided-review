import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { SpinnerIcon } from '../../components/icons';
import { useCreateDraft } from '../../ipc/hooks/useDrafts';
import { useAsk } from '../../ipc/hooks/useReview';
import type { DiffPosition } from '../../ipc/types/DiffPosition';
import type { LineSelection } from '../../ipc/types/LineSelection';
import { ClaudeLabel } from './ClaudeLabel';
import { decisionCopy } from './noteCopy';
import styles from './Notes.module.css';

export interface AnswerCardProps {
  sessionId: string;
  stepId: string;
  /** The selected lines the question is about; null asks about the whole step. */
  selection: LineSelection | null;
  selfReview?: boolean;
  /** B's Ask Claude and More › Ask Claude open the card with the input focused. */
  autoFocus?: boolean;
}

/** A draft from an answer sits on the selection's last line, or on the MR without one. */
const positionOf = (selection: LineSelection | null): DiffPosition | null =>
  selection ? { file: selection.file, side: selection.side, line: selection.end } : null;

/**
 * The answer card (F-10, M3 decision 4): note-card style with the Claude label, the question,
 * the streamed answer, Add to drafts (F-10.3) and Copy, and the input for follow-ups, which
 * continue the step's Claude session (F-10.2).
 */
export function AnswerCard({
  sessionId,
  stepId,
  selection,
  selfReview = false,
  autoFocus = false,
}: AnswerCardProps) {
  const { mutation, text, phase } = useAsk(sessionId, stepId);
  const createDraft = useCreateDraft();
  const [input, setInput] = useState('');
  const [question, setQuestion] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const copy = decisionCopy(selfReview);
  const answering = mutation.isPending;
  const done = phase === 'done' && !answering;

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  const ask = () => {
    const q = input.trim();
    if (q === '' || answering) return;
    setQuestion(q);
    setInput('');
    createDraft.reset();
    mutation.mutate({ question: q, selection });
  };

  return (
    <article className={styles.card} aria-label="Claude answer">
      <div className={styles.head}>
        {question !== null && <span className={styles.title}>{question}</span>}
        <ClaudeLabel />
      </div>

      {question !== null && (
        <div aria-live="polite" aria-busy={answering}>
          {text === '' && answering ? (
            <span className={styles.reading}>
              <SpinnerIcon className={styles.spinner} />
              Claude is reading this step…
            </span>
          ) : (
            <p className={styles.body}>{text}</p>
          )}
        </div>
      )}

      {mutation.error && (
        <p className={styles.error} role="alert">
          {mutation.error.message}
        </p>
      )}

      {done && text !== '' && (
        <div className={styles.actions}>
          {createDraft.isSuccess ? (
            <span className={styles.status}>{copy.added}</span>
          ) : (
            <Button
              variant="primary"
              disabled={createDraft.isPending}
              onClick={() => {
                createDraft.mutate({
                  sessionId,
                  findingId: null,
                  body: text,
                  position: positionOf(selection),
                  severity: null,
                });
              }}
            >
              {copy.add}
            </Button>
          )}
          <Button
            onClick={() => {
              navigator.clipboard.writeText(text).catch(() => undefined);
            }}
          >
            Copy
          </Button>
        </div>
      )}
      {createDraft.error && (
        <p className={styles.error} role="alert">
          {createDraft.error.message}
        </p>
      )}

      <form
        className={styles.ask}
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <input
          ref={field}
          className={styles.input}
          aria-label="Ask Claude about this step"
          placeholder="Ask Claude about this step…"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
          }}
        />
        <Button
          type="submit"
          variant="claude"
          size={36}
          disabled={input.trim() === '' || answering}
        >
          Ask Claude
        </Button>
      </form>
    </article>
  );
}
