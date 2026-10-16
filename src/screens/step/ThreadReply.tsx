import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import styles from './Thread.module.css';

export interface ThreadReplyProps {
  /** A reply is on its way to GitLab: Reply is disabled and a second Ctrl+Enter sends nothing. */
  busy: boolean;
  /** Sends the text as written (never blank). */
  onSend: (body: string) => void;
  /** Cancel or Esc: the composer closes and its text is dropped. */
  onCancel: () => void;
}

/**
 * The reply composer under a thread (F-11.2, M5 decision 1) in the note-card style: "Write a
 * reply…", Reply (yellow, Ctrl+Enter, disabled while blank) and Cancel (Esc). It keeps its text
 * while it is open, so a failed send loses nothing.
 */
export function ThreadReply({ busy, onSend, onCancel }: ThreadReplyProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blank = text.trim() === '';

  useEffect(() => {
    textareaRef.current?.focus();
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
          setText(event.target.value);
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
