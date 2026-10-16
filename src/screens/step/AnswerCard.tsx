import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { SpinnerIcon } from '../../components/icons';
import { useCreateDraft } from '../../ipc/hooks/useDrafts';
import { useAsk } from '../../ipc/hooks/useAsk';
import type { DiffPosition } from '../../ipc/types/DiffPosition';
import type { LineSelection } from '../../ipc/types/LineSelection';
import { ClaudeLabel } from './ClaudeLabel';
import { selectionLabel } from './lineSelection';
import { decisionCopy } from './noteCopy';
import styles from './Notes.module.css';

export interface AnswerCardProps {
  sessionId: string;
  stepId: string;
  /** The card (`AskState.nonce`): its thread is kept with the step's state (F-08.1). */
  nonce?: number;
  /** The selected lines the question is about; null asks about the whole step. */
  selection: LineSelection | null;
  selfReview?: boolean;
  /** B's Ask Claude and More › Ask Claude open the card with the input focused. */
  autoFocus?: boolean;
  /** A question typed in the guide panel (layout C): asked once when the card opens. */
  initialQuestion?: string;
  /**
   * The card's own input for follow-ups; S-04 asks them from the Guide aside's Ask box instead
   * (M4 decision 7).
   */
  followUp?: boolean;
}

/** A draft from an answer sits on the selection's last line, or on the MR without one. */
const positionOf = (selection: LineSelection | null): DiffPosition | null =>
  selection ? { file: selection.file, side: selection.side, line: selection.end } : null;

/**
 * The answer card (F-10, M3 decision 4): note-card style with the Claude label, the question,
 * the streamed answer, Add to drafts (F-10.3) and Copy, and the input for follow-ups, which
 * continue the step's Claude session (F-10.2). The question and answer are kept with the step's
 * state, so a card shown again after a layout or mode switch neither asks nor takes the focus again.
 */
export function AnswerCard({
  sessionId,
  stepId,
  nonce = 0,
  selection,
  selfReview = false,
  autoFocus = false,
  initialQuestion,
  followUp = true,
}: AnswerCardProps) {
  const thread = useAsk(sessionId, stepId, nonce);
  const createDraft = useCreateDraft();
  const [input, setInput] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const copy = decisionCopy(selfReview);
  const question = thread.thread?.question ?? null;
  const text = thread.thread?.text ?? '';
  const answering = thread.thread?.asking === true;
  const done = thread.thread?.phase === 'done' && !answering;
  const added = createDraft.isSuccess || thread.thread?.added === true;
  // Opened now, not shown again after a layout or mode switch.
  const fresh = useRef(thread.thread === null);

  const send = (q: string) => {
    setInput('');
    createDraft.reset();
    thread.ask(q, selection);
  };
  const ask = () => {
    const q = input.trim();
    if (q === '' || answering) return;
    send(q);
  };
  useEffect(() => {
    if (!fresh.current) return;
    fresh.current = false;
    thread.open();
    if (autoFocus) field.current?.focus();
    const q = initialQuestion?.trim();
    if (q) thread.ask(q, selection);
    // Once, when the card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <article className={styles.card} aria-label="Claude answer">
      <div className={styles.head}>
        {/* The lines the question is about (F-10.1); the guide shows the card away from them. */}
        {selection && <span className={styles.lines}>{selectionLabel(selection)}</span>}
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

      {thread.thread?.error && (
        <p className={styles.error} role="alert">
          {thread.thread.error}
        </p>
      )}

      {done && text !== '' && (
        <div className={styles.actions}>
          {added ? (
            <span className={styles.status}>{copy.added}</span>
          ) : (
            <Button
              variant="primary"
              disabled={createDraft.isPending}
              onClick={() => {
                createDraft.mutate(
                  {
                    sessionId,
                    findingId: null,
                    body: text,
                    position: positionOf(selection),
                    severity: null,
                  },
                  { onSuccess: thread.added },
                );
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

      {followUp && (
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
      )}
    </article>
  );
}
