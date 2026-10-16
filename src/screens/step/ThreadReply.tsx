import { useLayoutEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import styles from './Thread.module.css';

export interface ThreadReplyProps {
  /** The text typed so far (kept with the step's state, so a remounted composer shows it). */
  text: string;
  /** The composer was just opened: it takes the keyboard focus, then calls `onFocused`. */
  focus: boolean;
  onFocused: () => void;
  onText: (text: string) => void;
  /** A reply is on its way to GitLab: Reply is disabled and a second Ctrl+Enter sends nothing. */
  busy: boolean;
  /** Sends the text as written (never blank). */
  onSend: (body: string) => void;
  /** Cancel or Esc: the composer closes and its text is dropped. */
  onCancel: () => void;
}

/**
 * The reply composer under a thread (F-11.2, M5 decision 1) in the note-card style: "Write a
 * reply…", Reply (yellow, Ctrl+Enter, disabled while blank) and Cancel (Esc). Its text lives with
 * the step's state (`useThreadCard`), so a failed send or a card scrolled out of view and back
 * loses nothing.
 */
export function ThreadReply({
  text,
  focus,
  onFocused,
  onText,
  busy,
  onSend,
  onCancel,
}: ThreadReplyProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blank = text.trim() === '';

  // Mounted again (the card was out of view): the text comes back as the field's value. Only a
  // composer just opened takes the focus; one coming back into view leaves it where it is.
  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.value = text;
    if (focus) {
      field.focus();
      onFocused();
    }
    // Once per mount: afterwards the field holds what the reader types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    if (blank || busy) return;
    onSend(text);
  };

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onCancel();
      }}
    >
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        aria-label="Reply"
        placeholder="Write a reply…"
        // Uncontrolled: the typed text stays the field's value only, never its text content,
        // so nothing on the page reads as the reply before GitLab has it.
        defaultValue=""
        onChange={(event) => {
          onText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !event.ctrlKey) return;
          event.preventDefault();
          send();
        }}
      />
      <div className={styles.row}>
        <Button type="submit" variant="primary" disabled={blank || busy}>
          Reply
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
